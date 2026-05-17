# Security

*This document is a placeholder — full threat model is task 5.11 (Phase 5).*

## Surface summary

| Surface | Control |
|---------|---------|
| Session creation abuse | Rate limit: 5/IP/hour + 100/global/hour (DEC-009) |
| Session code guessing | 6-char code from 32-char unambiguous alphabet (~10⁹ space); empty sessions expire in 15min |
| IP audit logging | IPs are HMAC-hashed before storage; raw IP never persisted |
| PII | Nicknames only; no email, no account, no device fingerprinting |
| TLS | Terminated at Cloudflare edge (reference deploy) or Caddy/Let's Encrypt (alternative) |
| Inbound ports | Reference deployment has no inbound ports open on the VM (Cloudflare Tunnel) |
| XSS | SvelteKit escapes template output by default; CSP header on all pages (task 3.13) |
| Input validation | All user inputs validated server-side before any state mutation |
| Host token | Issued at session creation, stored client-side, required to reconnect as host |

## Known gaps (v1)

- No screen-reader / WCAG AA compliance (documented in a11y statement)
- No full security audit before the launch gate (task 5.8 covers this)
- Threat model document: task 5.11
