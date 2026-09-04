# TLS Termination

`[tls]` makes Nitr's own listener speak HTTPS: rustls over the `ring`
crypto provider, terminated in Rust before a request ever reaches a Lua
state. A handler written for plaintext serves over TLS unchanged —
there is no per-route switch, no `req.tls`, nothing to opt into. The
transport is the server's problem, not the application's.

It needs the **`tls` Cargo feature**. The `nitr` binary ships with it
(the CLI's default feature set is `all`); an embedding Rust application
asks for it explicitly — see
[Cargo features](../library/cargo-features). A binary built without it
refuses to start on `enabled = true` and says so:

```text
[tls] enabled = true, but this binary was built without the `tls`
feature: rebuild with `--features tls` (or `all`)
```

TLS is **off by default and never inferred** from a certificate lying
around next to the config. Turning a port from plaintext to TLS is a
decision an operator makes, not one a stray file makes for them.

## Turning it on converts the port

Read this before you enable anything.

> [!DANGER] `enabled = true` converts the single listener — it does not add one
>
> The moment TLS is on, the address in `listen` speaks HTTPS and
> **nothing anywhere answers plaintext**. There is no dual-listener
> mode and nothing redirects for you. Every `http://` client, bookmark,
> curl in a runbook and external health check breaks at the same
> instant.

A plain HTTP request to a TLS port is **refused, never served in the
clear**: the
listener never falls back to cleartext, because answering a `GET` over
an unencrypted socket while every operator believes the port is
encrypted is the worse failure by a wide margin. The connection that
failed is the only one affected.

If clients that still say `http://` must keep working, run the
[redirect instance](#redirecting-plaintext-to-https) below alongside,
on the old address.

## Quick start

A self-signed certificate is enough to exercise the whole path locally.
Nothing about the server changes for a real one — only where the two
files come from.

Mint a throwaway pair:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout key.pem -out cert.pem
chmod 600 key.pem
```

Point `[tls]` at it:

```toml
listen = "127.0.0.1:3000"
handler_script = "app.lua"

[tls]
enabled = true
cert = "cert.pem"
key = "key.pem"
```

Then prove it before trusting it:

```sh
nitr check                        # loads the pair; a broken one fails here
nitr run

curl -k https://127.0.0.1:3000/   # -k: a self-signed cert is trusted by nobody
curl http://127.0.0.1:3000/       # refused — the port is not plaintext
```

The startup log names the scheme and the material it loaded, so the
first `curl` of a deployment goes to the right URL:

```text
TLS enabled: 1 certificate(s), minimum version 1.2, ALPN ["http/1.1"]
listening on https://127.0.0.1:3000 with 4 Lua state(s)
```

> [!TIP] The runnable version
>
> The Nitr repository ships an `examples/tls` that mints its own
> throwaway certificate on every run, so there is nothing to install
> and no key material committed anywhere:
>
> ```sh
> cargo run --example tls --features tls
> ```

## The `[tls]` section

| Key            | Default                      | Accepted values                                           |
| -------------- | ---------------------------- | --------------------------------------------------------- |
| `enabled`      | `false`                      | `true` / `false`                                          |
| `cert`         | _(required when enabled)_    | Path to a PEM chain: leaf first, then intermediates       |
| `key`          | _(required when enabled)_    | Path to a PEM private key: PKCS#8, PKCS#1 or SEC1         |
| `min_version`  | `"1.2"`                      | `"1.2"` or `"1.3"` — nothing else, under any spelling     |
| `handshake_ms` | `min(header_read_ms, 10000)` | A positive number of milliseconds. `0` is a startup error |

The annotated original is in
[`nitr.toml`](./configuration/file#tls).

```toml
[tls]
enabled = true
cert = "/etc/nitr/tls/fullchain.pem"   # leaf first, then intermediates
key = "/etc/nitr/tls/privkey.pem"      # PKCS#8, PKCS#1 or SEC1
# min_version = "1.3"                  # default: "1.2", the floor
# handshake_ms = 10000                 # default: min(header_read_ms, 10s)
```

### `cert` and `key`

`cert` is the **chain**, not just the leaf. Clients that do not already
hold your intermediate cannot build a path to a trusted root, and the
failure looks like "works on my machine" — your browser cached the
intermediate, the customer's did not. Every `CERTIFICATE` block in the
file is kept, in file order, leaf first.

`key` is the matching private key in any of the three encodings openssl
and the ACME clients emit: PKCS#8 (`BEGIN PRIVATE KEY`), PKCS#1
(`BEGIN RSA PRIVATE KEY`) or SEC1 (`BEGIN EC PRIVATE KEY`). Only the
first key in the file is used.

Both are **required** once `enabled = true`, and neither is guessed
from the other's location.

### `min_version`

The default, `"1.2"`, is also the floor, and it is what a public
endpoint wants. Set `"1.3"` only for a closed set of clients known to
speak it — a browser is not that set.

TLS 1.0 and 1.1 **cannot be selected under any spelling**. They are
deprecated by RFC 8996 and rustls implements neither, so accepting
`"1.1"` would promise a downgrade no build can keep. `"1.0"`, `"1.1"`,
`"1"`, `"TLSv1.3"`, `"SSLv3"` and `""` are all startup refusals that
name the setting.

The version name is validated **before** the PEM is parsed, on purpose:
a typo in `min_version` is fixable without touching a key, so it should
not be hidden behind a certificate error.

### `handshake_ms`

The deadline for the TLS handshake itself, in milliseconds. Unset means
`min(header_read_ms, 10s)` — with the default
[`[limits] header_read_ms`](./configuration/file) of 30 000 ms, that is
**10 seconds**.

The handshake runs inside the connection's own task, so a slow or
hostile `ClientHello` costs **one connection, not the accept loop**.
But it still holds one slot against `[limits] max_connections` until
the deadline fires, which is why the deadline is never optional.

> [!WARNING] `handshake_ms = 0` is a startup error, never "unbounded"
>
> `0` is how `[limits]` spells "disabled", and it is exactly the
> spelling this key must refuse. The handshake happens _before_ hyper's
> header machinery exists, so an unbounded one holds a connection slot
> nothing else can reclaim — and 1024 of those close the listener.
> `[limits] header_read_ms = 0` disables hyper's header deadline and
> still leaves the handshake bounded at 10 s; the two are different
> waits on different protocol phases, and a streaming deployment that
> relaxes the first says nothing about the second.

## Startup: validated before a port exists

The certificate and the key are read **before the listener binds**, and
validated together. A half-configured or mismatched pair is therefore a
startup failure naming the file, not a listener that accepts TCP and
then fails every handshake — which, from the outside, is
indistinguishable from a network fault, and which surfaces only _after_
a deployment has already shifted traffic onto the port.

The same load runs again on every
[reload](#certificate-renewal), with the same validation and the same
refusal to accept a broken pair — so what follows is as much about
`SIGHUP` as it is about boot.

`nitr check` performs a real build, so it catches every one of these
before the artifact goes anywhere:

| Mistake                                     | What you get                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `enabled = true` with no `cert` or no `key` | `[tls] enabled = true requires ...`, naming the missing setting         |
| A path that is not a readable file          | `[tls] cert points at ..., which is not a readable file`                |
| The certificate file passed for both        | `the key file holds no private key block`                               |
| A key file passed for both                  | `the certificate file holds no CERTIFICATE block`                       |
| Truncated or garbled PEM                    | `the certificate PEM is malformed` / `the private key PEM is malformed` |
| A valid key that belongs to another cert    | `the certificate and key were rejected: ... mismatch`                   |

That last row is the one this whole design exists for: two perfectly
valid files that simply do not belong together. rustls refuses a key
whose public half is not the one the leaf certificate carries, so the
misconfiguration that would otherwise surface as _every client failing
the handshake_ is a boot refusal instead.

> [!WARNING] A key readable beyond its owner warns, and boots anyway
>
> On Unix, a `[tls] key` with any group or other permission bit set
> (mode `0o077`) produces a startup warning naming the file and the
> mode. It is deliberately **not** a refusal: containers legitimately
> run as root with a mounted secret, and a security check whose failure
> mode is "the deployment does not come up" is a check that gets
> disabled. Protecting the file is the operator's job — `0600` or
> `0400`.

The PEM parser is fuzzed (`tls-pem`) rather than merely tested, because
those bytes are written by an ACME client or a mounted secret — not by
you — and a parser that only ever saw well-formed input is a parser
that has not been checked.

`nitr check --print-config` renders `[tls] key` back out **as a path**,
never as key bytes. A path to a private key is still secret-adjacent —
it tells a reader where to look — and the TLS error messages name the
same paths so a failed boot stays diagnosable. Treat the rendered
config and the startup log as belonging to the same trust domain as
`nitr.toml` itself.

> [!NOTE] What happens to the key in memory
>
> The PEM buffer read from disk is wiped when loading returns — on the
> reload path as well as at boot. The DER copy rustls keeps lives as
> long as the acceptor and is **not** wipeable; a reload replaces the
> acceptor, so the previous copy is dropped rather than wiped. That
> narrows the window in which a core dump yields the key; it does not
> close it.

## What the handshake offers

**ALPN is pinned to `http/1.1`** — exactly the one protocol the server
speaks. Advertising `h2` as well would let a client negotiate something
nothing here can talk, turning a working connection into a parse error
_after_ the handshake had already succeeded. There is no HTTP/2 over
this listener.

**The crypto provider is named, not inherited.** `ring` is passed in
explicitly rather than taken from rustls's process-global default slot,
which any dependency — or an embedder's own code — may have already
filled with something else. The cipher suites are a property of Nitr,
not of link order.

**The handshake is server-authenticated only.** There is no mTLS, so
"who is connecting" remains an application question — see
[Crypto & auth](./crypto-auth) and [JWT](./jwt).

## Certificate renewal

`[tls]` terminates TLS. It does not obtain, renew or rotate anything;
that stays with certbot, your ACME client or your CA.

A renewal takes effect on **`SIGHUP`** (or `nitr reload`, or
`systemctl reload`): the reload re-reads `[tls] cert` and `[tls] key`
from their configured paths and swaps the acceptor in **only when the
new pair validates**. A half-written file keeps the old material and
warns — a server that stops terminating TLS because certbot was
mid-write is strictly worse than one serving a certificate that is
still valid for another few days.

Connections already established keep the certificate they negotiated
with; new connections get the new one. Nothing is dropped.

```sh
nitr reload              # via the configured pidfile
kill -HUP <pid>          # the same thing
systemctl reload myapp   # ExecReload=/bin/kill -HUP $MAINPID
```

The pool reload and the TLS reload are **independent halves**: a failed
certificate re-read still rebuilds the Lua pool, and a failed pool
rebuild still swaps a good certificate.

> [!NOTE] What a reload does not re-read
>
> `nitr.toml` itself is never re-read, so `[tls] enabled`,
> `min_version` and `handshake_ms` keep their boot-time values — only
> the two **files** are re-read. Turning TLS on or off, or changing the
> minimum version, is a restart. See
> [Zero-downtime reload](./deployment/#zero-downtime-reload).

### An ACME deploy hook

Replace both files, then signal. certbot already writes atomically
(write-then-rename), so the window in which the reload could see half a
file is essentially the copy itself — which is why the copy uses
`install` rather than a shell redirect:

```sh
#!/bin/sh
# /etc/letsencrypt/renewal-hooks/deploy/50-nitr.sh
set -eu

install -m 0600 -o nitr -g nitr \
  "$RENEWED_LINEAGE/fullchain.pem" /etc/nitr/tls/fullchain.pem
install -m 0600 -o nitr -g nitr \
  "$RENEWED_LINEAGE/privkey.pem" /etc/nitr/tls/privkey.pem

systemctl reload myapp
```

`nitr reload` needs a `pidfile` in the configuration to find the
running server; `systemctl reload` does not, because systemd already
knows the pid.

Pointing `[tls] cert`/`key` straight at `/etc/letsencrypt/live/...`
works too and skips the copy, provided the service account can read
through to the `archive/` directory the symlinks resolve into. The
signal is still required either way: renewal alone changes nothing in a
running process.

## HSTS is the handler's job

There is deliberately **no `[tls] hsts` key**. HSTS is a commitment with
a long tail: a `max-age` mistake is cached by browsers and is _not_
retractable from the server side. That number is the operator's call,
never a framework default.

It is one response header, so it belongs in
[middleware](./middleware):

```lua
app:use(function(next)
    return function(req)
        local res = next(req)
        -- 180 days. Start smaller (e.g. 86400) until the deployment has
        -- survived a certificate renewal; add "; includeSubDomains" only
        -- if every subdomain is HTTPS-only — that switch commits them all.
        res.headers["Strict-Transport-Security"] = "max-age=15552000"
        return res
    end
end)
```

> [!WARNING] `includeSubDomains` and `preload` are one-way doors
>
> `includeSubDomains` commits **every** subdomain, including ones that
> do not exist yet and ones served by somebody else's box. `preload`
> hard-codes your domain into browsers that ship before you can change
> your mind. Neither is undone by removing the header; you wait out the
> `max-age` you published, on every client that ever saw it.

## Redirecting plaintext to HTTPS

There is no dual-listener mode, so the plaintext side is simply a
second, tiny Nitr instance whose entire application is a 301.

```lua
-- redirect.lua — the entire application of the :80 instance. Routes, not
-- middleware: middleware only wraps matched routes, and this instance
-- must answer *every* path.
local app = nitr.app()
local CANONICAL = "https://example.com"   -- configuration, not req.headers.host

local function to_https(req)
    local target = CANONICAL .. req.path
    if req.uri.query ~= "" then
        target = target .. "?" .. req.uri.query
    end
    return nitr.redirect(target, 301)
end

app:get("/", to_https)
app:get("/*", to_https)

return app
```

Its configuration is the boring half — plaintext, one worker, no
database, no templates:

```toml
listen = "0.0.0.0:80"
handler_script = "redirect.lua"
workers = 1
```

Two properties are load-bearing:

- **Routes, not middleware.** Middleware only wraps _matched_ routes,
  and this instance has to answer every path there is. `/` plus `/*`
  covers them; see [Routing](./routing).
- **The canonical host is configuration.** Never build the target from
  `req.headers.host`. An attacker-supplied `Host` turns the helper into
  an open redirect that your own domain vouches for.

> [!DANGER] `req.headers.host` is attacker-controlled input
>
> A request to your `:80` instance carrying `Host: evil.example.net`
> must still redirect to _your_ origin. The snippet above is exercised
> by Nitr's own test suite with exactly that header, so the pattern
> cannot rot.

Both snippets on this page — the HSTS middleware and this redirect
instance — are executed by an integration test rather than quoted, so
they stay correct as the server changes.

## Health probes stay plaintext

With `[health] bind` set, the probe listener is **plaintext even under
`[tls]`**, and the startup line says so rather than implying it:

```text
health endpoints on http://127.0.0.1:9090 (plaintext; TLS terminates on
the main listener only)
```

That is a decision, not an oversight: a prober that must complete a TLS
handshake is a prober that fails during exactly the certificate trouble
liveness must survive. The port serves nothing but the two fixed probe
paths. An operator who cannot accept a cleartext probe port sets
`[health] enabled = false`, or leaves `bind` unset so the probes answer
on the main listener over TLS like everything else. See
[Deployment](./deployment/#health-probes).

## Cookies follow `[tls]`

`[cookies] secure` decides whether the cookies **Nitr builds** — the
session cookie, the CSRF cookie, and anything through
`res.cookies:set` / `:set_signed` — carry the `Secure` attribute:

| Value      | Meaning                                           |
| ---------- | ------------------------------------------------- |
| `"auto"`   | Secure when `[tls] enabled = true` (the default)  |
| `"always"` | Always Secure: TLS is terminated in front of Nitr |
| `"never"`  | Never Secure: plain-HTTP development              |

So with `[tls] enabled = true` and the default `"auto"`, the cookies
become `Secure` on their own. When `"auto"` resolves to _not_ secure,
that warns at startup instead of guessing, and `"never"` together with
TLS enabled is called out as the contradiction it is. Two cases stay
deliberately silent: `"never"` on a plaintext listener — you have
answered the question — and any `dev_mode = true` run. Details, and
what an explicit `secure` in a Lua options table does, are in
[Cookies & sessions](./cookies-sessions).

## `nitr build` leaves the key outside

`nitr build` re-anchors the application's relative paths — scripts,
templates, static files — inside the extraction directory. It
**deliberately does not re-anchor `[tls] cert` and `[tls] key`**, and
it never archives them.

> [!WARNING] A private key inside a copyable one-file artifact leaks with it
>
> Keep the key external, like the database. A relative `[tls] key` in a
> bundle resolves against the **working directory** at run time, not
> against the bundle — absolute paths are the clearer choice. Note also
> that `nitr.toml` itself _is_ archived, so the key's **path** travels
> with the artifact even though its bytes do not.

See [Single-file builds](./deployment/single-file).

## Environment overrides

The usual precedence applies (flags, then env, then file, then
defaults), so an image can ship one `nitr.toml` and take its
certificate paths per environment:

| Variable               | Key                 |
| ---------------------- | ------------------- |
| `NITR_TLS_ENABLED`     | `[tls] enabled`     |
| `NITR_TLS_CERT`        | `[tls] cert`        |
| `NITR_TLS_KEY`         | `[tls] key`         |
| `NITR_TLS_MIN_VERSION` | `[tls] min_version` |

```sh
NITR_TLS_ENABLED=true \
NITR_TLS_CERT=/run/secrets/fullchain.pem \
NITR_TLS_KEY=/run/secrets/privkey.pem \
  nitr run
```

An **empty** value counts as unset, so `NITR_TLS_CERT=` in a unit file
means "I did not set this" rather than "use the empty path". There is
no environment override for `handshake_ms`. See
[Environment variables](./configuration/env).

## When not to use it

Most deployments should **not** turn `[tls]` on, and that is not a
compromise. If a load balancer, an ingress controller or an nginx/Caddy
front end already terminates TLS, terminating it a second time buys
nothing and adds a certificate to rotate.

The right shape there is:

```toml
listen = "127.0.0.1:3000"       # loopback: the proxy is the only client

[tls]
enabled = false                 # the default; the proxy terminates

[cookies]
secure = "always"               # ...but the cookies must still be Secure

[rate_limit]
trust_forwarded_for = true      # ONLY if the proxy overwrites X-Forwarded-For
```

`[cookies] secure = "always"` is the important line. This is the most
common deployment there is, and it is exactly the one `"auto"` gets
wrong: `[tls] enabled = false` is _correct_ for this process while the
cookies must still be `Secure`. Nothing in Nitr can detect the proxy,
so leaving `"auto"` here warns at boot rather than guessing:

```text
session and CSRF cookies will be sent without the `Secure` attribute:
[tls] enabled = false, and [cookies] secure = "auto" follows it. If TLS
is terminated by a proxy in front of this process, set [cookies]
secure = "always" — nothing here can detect that proxy.
```

HSTS, in that arrangement, belongs to the proxy too. And
`trust_forwarded_for` is safe **only** if the proxy overwrites
`X-Forwarded-For` rather than appending to whatever the client sent —
see [Deployment](./deployment/#terminating-at-a-proxy-in-front) and
[Security](./security).

## Production checklist

- [ ] `cert` is the full chain (leaf **plus** intermediates), verified
      from a machine that does not already hold the intermediate.
- [ ] `key` is mode `0600` or `0400` and owned by the service account.
- [ ] `nitr check` run against the real configuration before the deploy,
      so a mismatched pair fails on your machine and not on the port.
- [ ] Every `http://` reference — clients, bookmarks, external monitors,
      the load balancer's own health check — moved to `https://`, or a
      [redirect instance](#redirecting-plaintext-to-https) left running
      on the old address.
- [ ] A renewal hook that replaces both files and then signals
      `SIGHUP`, tested once end to end rather than trusted.
- [ ] HSTS emitted by the handler, starting with a small `max-age`, and
      `includeSubDomains` added only when every subdomain is HTTPS.
- [ ] `[cookies] secure` resolves to secure — no startup warning about
      the `Secure` attribute in the boot log.
- [ ] `[tls] key` outside anything `nitr build` produces, and outside
      any image layer that gets pushed to a registry.
- [ ] Binding `:443` handled without keeping the privilege: socket
      activation, a granted `CAP_NET_BIND_SERVICE`, or a high port with
      the redirect done upstream. The reference
      [systemd unit](./deployment/systemd) drops every capability, so
      the capability has to be granted back deliberately.
- [ ] `min_version = "1.3"` only where every client is known to speak
      it — otherwise leave the `"1.2"` floor.
