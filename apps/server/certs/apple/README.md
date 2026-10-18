# Apple root certificates

Trust anchors for App Store signed transactions and notifications (ADR-0024,
`APP_STORE_ROOT_CERTS`). The image copies this folder to `/etc/ssl/apple`.

| File | Subject | Expires | SHA-256 (DER) |
| --- | --- | --- | --- |
| `AppleRootCA-G3.cer` | CN=Apple Root CA - G3, OU=Apple Certification Authority, O=Apple Inc., C=US | 2039-04-30 | `63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179` |

Exported from the macOS system root keychain; the fingerprint matches the one Apple
publishes at <https://www.apple.com/certificateauthority/>. To check a copy:

```sh
shasum -a 256 apps/server/certs/apple/AppleRootCA-G3.cer
```

Replace it only with a certificate from Apple's certificate authority page whose
fingerprint you have checked there.
