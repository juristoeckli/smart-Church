# Delivery plan

Status: implementation started. The TypeScript workspace, shared contact types, Core API and PostgreSQL-backed local People directory are in place. Local authentication and permission checks remain outstanding.

## Milestone 1 — foundation

Agreed scope: Core, departments, local login, permissions, worker management, required Notifications/System Management modules and one example module.

- [x] [M1: Set up TypeScript workspace and shared contracts](https://github.com/juristoeckli/smart-Church/issues/1)
- [ ] [M1: Implement installation setup and department isolation](https://github.com/juristoeckli/smart-Church/issues/2) — development contacts are scoped to a configured department; first-run setup and user-selected department context remain outstanding.
- [ ] [M1: Implement local authentication and scoped permissions](https://github.com/juristoeckli/smart-Church/issues/3)
- [ ] [M1: Implement module SDK and worker supervision](https://github.com/juristoeckli/smart-Church/issues/4)
- [ ] [M1: Build shared React shell and example module](https://github.com/juristoeckli/smart-Church/issues/5)
- [ ] [M1: Add required Notifications module](https://github.com/juristoeckli/smart-Church/issues/6)
- [ ] [M1: Add required System Management module](https://github.com/juristoeckli/smart-Church/issues/7)
- [ ] [M1: Verify end-to-end isolation and failure recovery](https://github.com/juristoeckli/smart-Church/issues/8)

Suggested order: #1 → #2/#3 → #4 → #5/#6/#7 → #8. These are dependencies, not an instruction to implement all later features now.

Completion: a browser user can log in, select an authorised department, edit an example record via its worker, receive live updates and inspect scoped module health. Department access remains isolated and a crashing/hanging worker does not take down the application.

## Later milestones — proposed grouping, not fixed implementation scope

1. Desktop and offline: Electron shell, SQLite adapters, profile modes, last-confirmed permissions, offline editing/conflicts, module-specific incompatible-reset flow and selected local workers.
2. Identity and sharing: remote installation signing/trust, home-server authentication, explicit central administration grants, cross-server department navigation, library sharing and readonly replicas; push login approval and password recovery.
3. Files and retention: shared storage APIs, per-module browsers, resumable 2 GB uploads/quotas, separate licensed datasets, offline downloads, History/trash.
4. Operations: Backup selectable Application/Storage/Database, recovery tool, managed PostgreSQL/external option, optional Nginx, resource limits and managed GitHub Release updates.
5. Optional interfaces/modules: Kiosk, actual device-control modules and Android wrapper.

Some infrastructure will need earlier primitives; implement those narrowly without pulling entire later workflows into Milestone 1.

## Future, not required now

Active/passive department availability. Preserve department identity/export-import design, but no continuous replication or automatic failover initially.

## Outstanding implementation decisions

- Precise signed-request standard, key storage/rotation/recovery.
- SSO protocol and home-server unavailable behaviour.
- Release integrity/signature verification.
- Third-party UI extension build/loading and dependency policy.
- Exact file/database adapters and deployment packaging.
- Private-field encryption/key custody, offline private-data policy.
- OTP sizes/brute-force policies, detailed session lifetimes.
- Which Sync/Backup/History capabilities are required in each supported deployment.

Refer to [ARCHITECTURE.md](ARCHITECTURE.md) for all agreed behaviour. Do not treat outstanding details as already implemented or decided.
