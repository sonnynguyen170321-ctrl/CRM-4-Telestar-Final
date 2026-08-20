# Capability profiles

**Knowledge comes from skills. Authority comes from the profile.**

A profile says what an agent may *do*, never what it knows. The two are separated so that
loading the production-release skill does not confer the ability to deploy, and so that a
reviewer cannot quietly become an author.

Give an agent the smallest tool set its job needs. A code explorer does not need production
SSH, email sending, deployment credentials or GitHub writes. A browser tester does not need
production database write access. A verifier must not edit the candidate it is certifying.

Where the platform supports it, enforce this with tool allowlists rather than instructions —
an instruction not to use a tool is a request; an absent tool is a guarantee.

| Profile | Writes code | Runs tests | Touches production |
|---|---|---|---|
| explorer | no | no | no |
| implementer | yes | yes | no |
| verifier | no | yes | no |
| security-reviewer | no | yes | no |
| browser-tester | no | yes (browser) | no |
| release-certifier | no | reads results | no |
| production-operator | no | no | only with explicit authorization |
