import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, get } from './api';
import { formatDate, t, tCode, type MessageKey } from './i18n';
import { entityHref } from './route';

/** Album purchase (ADR-0018, provisional; docs/03-architecture/commerce.md). */

interface Money {
  amount_minor: number;
  currency: string;
  tax_minor: number;
}

interface ReleaseOffer {
  offer_id: string;
  price: Money;
  owned: boolean;
  pending_order_id: string | null;
  checkout_available: boolean;
  terms: { terms_version: string };
}

interface Order {
  order_id: string;
  status: string;
  kind: 'release' | 'subscription';
  release_id: string | null;
  release_title: string | null;
  price: Money;
  checkout_url: string | null;
  created_at: string;
}

const ORDER_STATUS: Record<string, MessageKey> = {
  pending: 'purchase.status.pending',
  paid: 'purchase.status.paid',
  fulfilled: 'purchase.status.fulfilled',
  cancelled: 'purchase.status.cancelled',
  expired: 'purchase.status.expired',
  refund_pending: 'purchase.status.refund_pending',
  refunded: 'purchase.status.refunded',
};

/** Prices come from the server in integer minor units; KRW has none. */
export function formatPrice(m: Money): string {
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: m.currency }).format(
    m.amount_minor,
  );
}

/** The sandbox provider's checkout lives on the API (dev only); a real one is a redirect. */
const isMockCheckout = (url: string) => url.includes('/dev/mock-pay/checkouts/');

/**
 * Offer, terms and checkout for a release. Nothing shows when the release is not
 * for sale in the user's region. Payment is confirmed only by the provider's
 * event on the server; the page waits for the order to change (COM-004, COM-010).
 */
export function PurchasePanel({
  releaseId,
  onPurchased,
}: {
  releaseId: string;
  onPurchased: () => void;
}) {
  const [offer, setOffer] = useState<ReleaseOffer | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    get<ReleaseOffer>(`/v1/releases/${releaseId}/offer`).then(
      (o) => {
        setOffer(o);
        if (o.pending_order_id) void get<Order>(`/v1/orders/${o.pending_order_id}`).then(setOrder);
      },
      () => {
        setOffer(null);
      },
    );
  }, [releaseId]);
  useEffect(load, [load]);

  if (!offer) return null;
  const pending = order?.status === 'pending' && order.checkout_url ? order : null;
  return (
    <section className="card" aria-label={t('purchase.heading')}>
      <h3>{t('purchase.heading')}</h3>
      <p>
        <strong>{formatPrice(offer.price)}</strong>{' '}
        <span className="small muted">
          {t('purchase.vat', {
            vat: formatPrice({ ...offer.price, amount_minor: offer.price.tax_minor }),
          })}
        </span>
        {offer.owned ? <span className="badge"> {t('purchase.owned')}</span> : null}
      </p>
      {pending ? (
        <CheckoutBox
          order={pending}
          onSettled={(o) => {
            setOrder(o);
            if (o.status === 'fulfilled') {
              setMsg(t('purchase.done'));
              onPurchased();
              load();
            } else {
              setMsg(tCode(ORDER_STATUS, o.status));
            }
          }}
          onWaiting={setMsg}
        />
      ) : (
        <form
          aria-label={t('purchase.form')}
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setMsg(null);
            api<Order>(
              'POST',
              '/v1/orders',
              { offer_id: offer.offer_id, confirm_already_owned: offer.owned },
              { 'idempotency-key': `order-${crypto.randomUUID()}` },
            )
              .then(({ data }) => {
                setOrder(data);
              })
              .catch((err: unknown) => {
                setMsg(
                  err instanceof ApiError && err.status === 503
                    ? t('purchase.unavailable')
                    : err instanceof ApiError
                      ? t('error.withCode', { message: err.message, code: err.code })
                      : String(err),
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <ul className="small">
            <li>{t('purchase.terms.right')}</li>
            <li>{t('purchase.terms.subscription')}</li>
            <li>{t('purchase.terms.withdrawal')}</li>
            <li>{t('purchase.terms.download')}</li>
          </ul>
          <label>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => {
                setAgreed(e.target.checked);
              }}
            />{' '}
            {t('purchase.agree')}
          </label>
          <div className="actions">
            <button type="submit" disabled={!agreed || busy || !offer.checkout_available}>
              {t(offer.owned ? 'purchase.buyAgain' : 'purchase.buy')}
            </button>
          </div>
          {offer.checkout_available ? null : (
            <p className="small muted">{t('purchase.unavailable')}</p>
          )}
        </form>
      )}
      {msg ? <p role="status">{msg}</p> : null}
    </section>
  );
}

/** Polls an order until the provider's event settles it (up to a minute). */
async function settle(orderId: string): Promise<Order | null> {
  for (let i = 0; i < 60; i++) {
    const o = await get<Order>(`/v1/orders/${orderId}`);
    if (o.status !== 'pending') return o;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/**
 * The checkout of a pending order: the sandbox provider's buttons (dev only) or a
 * link to the provider's page, and a way to abandon the order.
 */
function CheckoutBox({
  order,
  onSettled,
  onWaiting,
}: {
  order: Order;
  onSettled: (o: Order) => void;
  onWaiting: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const url = order.checkout_url ?? '';
  return (
    <div role="group" aria-label={t('purchase.checkout')}>
      {isMockCheckout(url) ? (
        <>
          <p className="small muted">{t('purchase.mock.note')}</p>
          <div className="actions">
            {(['succeeded', 'failed'] as const).map((outcome) => (
              <button
                key={outcome}
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  onWaiting(t('purchase.confirming'));
                  void fetch(`${url}/complete`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ outcome }),
                  })
                    .then(() => settle(order.order_id))
                    .then((o) => {
                      if (o) onSettled(o);
                      else onWaiting(t('purchase.waiting'));
                    })
                    .finally(() => {
                      setBusy(false);
                    });
                }}
              >
                {t(outcome === 'succeeded' ? 'purchase.mock.pay' : 'purchase.mock.fail')}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p>
          <a className="button" href={url}>
            {t('purchase.pay')}
          </a>
        </p>
      )}
      <button
        type="button"
        className="link"
        disabled={busy}
        onClick={() => {
          void api<Order>('POST', `/v1/orders/${order.order_id}/cancel`).then(({ data }) => {
            onSettled(data);
          });
        }}
      >
        {t('purchase.cancel')}
      </button>
    </div>
  );
}

interface Plan {
  plan: string;
  price: Money;
  available: boolean;
  checkout_available: boolean;
  current: { state: string; paid_through: string; auto_renew: boolean } | null;
  pending_order_id: string | null;
}

/**
 * Monthly subscription through the payment provider (COM-008, provisional price).
 * Stopping renewal keeps the paid month; it is not a refund.
 */
export function SubscriptionPanel() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    void get<Plan>('/v1/subscription/plan').then((p) => {
      setPlan(p);
      if (p.pending_order_id) void get<Order>(`/v1/orders/${p.pending_order_id}`).then(setOrder);
    });
  }, []);
  useEffect(load, [load]);
  if (!plan?.available) return null;
  const cur = plan.current;
  const renewing = cur?.state === 'active' && cur.auto_renew;
  const pending = order?.status === 'pending' && order.checkout_url ? order : null;
  return (
    <section className="card" aria-label={t('subscribe.heading')}>
      <h3>{t('subscribe.heading')}</h3>
      <p>
        <strong>{t('subscribe.price', { price: formatPrice(plan.price) })}</strong>{' '}
        <span className="small muted">
          {t('purchase.vat', {
            vat: formatPrice({ ...plan.price, amount_minor: plan.price.tax_minor }),
          })}
        </span>
      </p>
      {cur && cur.state === 'active' ? (
        <p>
          {renewing
            ? t('subscribe.renews', { date: formatDate(cur.paid_through) })
            : t('subscribe.ends', { date: formatDate(cur.paid_through) })}
        </p>
      ) : null}
      {cur?.state === 'past_due' ? <p>{t('subscribe.pastDue')}</p> : null}
      {pending ? (
        <CheckoutBox
          order={pending}
          onSettled={(o) => {
            setOrder(o);
            setMsg(o.status === 'fulfilled' ? t('subscribe.done') : tCode(ORDER_STATUS, o.status));
            load();
          }}
          onWaiting={setMsg}
        />
      ) : renewing ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!confirm(t('subscribe.stop.confirm'))) return;
            setBusy(true);
            void api('POST', '/v1/subscription/cancel')
              .then(() => {
                setMsg(t('subscribe.stopped'));
                load();
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {t('subscribe.stop')}
        </button>
      ) : cur?.state === 'active' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api('POST', '/v1/subscription/resume')
              .then(() => {
                setMsg(t('subscribe.resumed'));
                load();
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {t('subscribe.resume')}
        </button>
      ) : (
        <>
          <p className="small muted">{t('subscribe.terms')}</p>
          <button
            type="button"
            disabled={busy || !plan.checkout_available}
            onClick={() => {
              setBusy(true);
              setMsg(null);
              api<Order>(
                'POST',
                '/v1/subscription/checkout',
                {},
                {
                  'idempotency-key': `sub-${crypto.randomUUID()}`,
                },
              )
                .then(({ data }) => {
                  setOrder(data);
                })
                .catch((err: unknown) => {
                  setMsg(err instanceof ApiError ? err.message : String(err));
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {t('subscribe.start')}
          </button>
        </>
      )}
      {msg ? <p role="status">{msg}</p> : null}
    </section>
  );
}

/** Purchase history on the Account page. */
export function Orders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  useEffect(() => {
    void get<{ items: Order[] }>('/v1/orders').then((r) => {
      setOrders(r.items);
    });
  }, []);
  if (!orders) return null;
  return (
    <section className="card" aria-labelledby="orders-h">
      <h3 id="orders-h">{t('purchase.orders.heading')}</h3>
      {orders.length === 0 ? (
        <p className="muted">{t('purchase.orders.empty')}</p>
      ) : (
        <ul className="list" aria-label={t('purchase.orders.heading')}>
          {orders.map((o) => (
            <li key={o.order_id}>
              <div>
                {o.release_id ? (
                  <a href={entityHref(o.release_id)}>{o.release_title}</a>
                ) : (
                  t('purchase.orders.subscription')
                )}{' '}
                · {formatPrice(o.price)}
                <div className="small muted">
                  {tCode(ORDER_STATUS, o.status)} · {formatDate(o.created_at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
