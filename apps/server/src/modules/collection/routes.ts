import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { routeLimit } from '../../platform/http/app.js';
import { requirePrincipal } from '../../platform/http/principal.js';
import { idOf, limitSchema, parse } from '../../platform/http/validation.js';
import {
  createPhysicalItem,
  deletePhysicalItem,
  getPhysicalItem,
  listPhysicalItems,
  updatePhysicalItem,
} from './service.js';

/** GTIN check digit (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function validGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = Array.from(code, Number);
  const check = digits.pop() ?? -1;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const fields = {
  format: z.enum(['cd', 'vinyl', 'cassette', 'other']),
  title: text(300),
  artist_name: text(300).nullable(),
  barcode: z.string().trim().refine(validGtin, 'must be a valid EAN/UPC barcode').nullable(),
  catalog_number: text(100).nullable(),
  release_id: idOf('release').nullable(),
  notes: z.string().max(2000).nullable(),
};

export function collectionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const params = z.object({ physical_item_id: idOf('physicalItem') });

  app.get('/v1/physical-items', async (req) => {
    const p = requirePrincipal(req.principal);
    const q = parse(
      z.object({ limit: limitSchema, cursor: z.string().max(512).optional() }),
      req.query,
    );
    return listPhysicalItems(ctx, p, q);
  });

  app.post('/v1/physical-items', routeLimit(120, '1 hour'), async (req, reply) => {
    const p = requirePrincipal(req.principal);
    const body = parse(
      z.strictObject({
        format: fields.format,
        title: fields.title,
        artist_name: fields.artist_name.optional(),
        barcode: fields.barcode.optional(),
        catalog_number: fields.catalog_number.optional(),
        release_id: fields.release_id.optional(),
        notes: fields.notes.optional(),
      }),
      req.body,
    );
    return reply.status(201).send(await createPhysicalItem(ctx.db, p, body));
  });

  app.get('/v1/physical-items/:physical_item_id', async (req) => {
    const p = requirePrincipal(req.principal);
    const { physical_item_id } = parse(params, req.params);
    return getPhysicalItem(ctx.db, p, physical_item_id);
  });

  app.patch('/v1/physical-items/:physical_item_id', async (req) => {
    const p = requirePrincipal(req.principal);
    const { physical_item_id } = parse(params, req.params);
    // Verification state is not writable by the owner (COL-002).
    const body = parse(z.strictObject(fields).partial(), req.body);
    return updatePhysicalItem(ctx.db, p, physical_item_id, body);
  });

  app.delete('/v1/physical-items/:physical_item_id', async (req, reply) => {
    const p = requirePrincipal(req.principal);
    const { physical_item_id } = parse(params, req.params);
    await deletePhysicalItem(ctx.db, p, physical_item_id);
    return reply.status(204).send();
  });
}
