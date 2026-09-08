# Security

## Reporting a vulnerability

Email **GWCRH@atomicmail.io** with "SECURITY" in the subject. Please include what you found, the
steps to reproduce it, and what an attacker could do with it. A proof of concept helps enormously.

Please report privately first rather than opening a public issue, and give a reasonable window for a
fix before disclosing. There is no bounty programme; this is a community project, and the thanks are
sincere but non-monetary.

## Scope

In scope: this repository's code, running as documented in [DEPLOY.md](DEPLOY.md). Particularly
welcome are authentication and session flaws, anything that lets one account read or change another
account's data, ways to award yourself Send Power that the rules do not permit, ways to vote more
than once or to vote without qualifying, and anything that defeats the encryption at rest.

Out of scope: the third-party services the site reads from (the chain's RPC, the block explorer, the
price API), issues that require a compromised device, and anything about a fork's own deployment.

## What this project does not claim

The project has a standing rule against security guarantees, and that applies here too. This document
describes mechanisms, not promises.

- **No claim that the site has never been compromised**, and no claim it cannot be.
- **Encryption at rest protects a stolen database, not a stolen server.** Emails, linked wallets,
  two-factor secrets, tracked wallets and per-user preference blobs are AES-256-GCM encrypted under
  a key held outside the database; passwords are scrypt-hashed, never stored; Data API keys are
  stored only as SHA-256 hashes. If the key is taken along with the data, that protection is gone.
  Public content — usernames, posts, comments, the follow graph — is stored in the clear, because
  it is public. Two deliberate exceptions keep a wallet next to an account in the clear: the wallet
  a Send Call publicly shows, and the record of the connect award.
- **The Data API returns a key holder's own data and public data only.** A key is minted for a
  verified on-chain burn; it never opens another user's private fields. Reports of any path that
  does are especially welcome.
- **Wallet sign-in is domain-bound, not phishing-proof.** The message you sign names this site, so a
  signature harvested elsewhere does not match what this server stored. That only helps if you read
  the first line before signing. The mechanism reduces a class of attack; it does not eliminate it.
- **The risk scores on New Pairs are heuristics on public data.** Not an audit, not a guarantee, and
  a perfect score on a very new token can mean "nothing could be checked yet".

## Operator responsibilities

If you self-host, these are yours and the code cannot do them for you:

- Set `DATA_KEY` in the environment, and back it up somewhere the database backups are not. If the
  key sits beside the database, "stolen database" and "stolen key" are the same event.
- Set `BASE_URL` to your real https origin. It drives the CSRF origin check, the Secure cookie flag
  and the domain baked into every wallet sign-in message.
- Set `TRUST_PROXY=1` behind a reverse proxy, or every visitor shares the proxy's IP and both the
  rate limits and the community anti-sybil caps stop working.
- Keep Node at 24 or newer.

The server prints warnings at boot when these look wrong. Read them.
