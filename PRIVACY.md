# Privacy Policy

**Effective date: July 1, 2026**

Amicus is an open-source, local-first developer tool — a CLI, an MCP server, and
a Claude Code plugin — that runs entirely on your own machine. This policy
explains what happens to your data when you use it.

## TL;DR

- Amicus does **not** collect, transmit, or store any of your data on servers
  operated by the author. There is **no telemetry, analytics, or tracking** of
  any kind.
- Everything Amicus stores stays **on your machine**.
- When you run a council or fork a conversation, Amicus sends your prompts and
  context to the **third-party AI model providers you choose**, using **your own
  API keys**. That data is then handled under *those providers'* privacy
  policies — not this one.

## Who operates Amicus

Amicus is maintained by Christian Wagner as an open-source project, distributed
via npm and GitHub. You install and run it locally. There is **no**
Amicus-operated server, account system, login, or backend.

## What Amicus does NOT do

- No telemetry, usage analytics, or crash reporting.
- No tracking or advertising identifiers.
- No collection of personal information.
- No transmission of your prompts, code, files, or conversations to the author
  or to any Amicus-operated service (there is none).

## Data stored locally on your machine

Amicus writes the following to your local filesystem **only**. None of it is
transmitted to the author.

- **Session transcripts and metadata** — saved under `.claude/amicus_sessions/`
  in your working directory so you can resume, read, and fold conversations.
- **Configuration** — your model preferences and settings.
- **API keys** — the provider keys you supply are stored locally (for example in
  a `.env` file or your local config) and are used only to authenticate your
  requests to the providers you selected. They are never sent anywhere except
  the corresponding provider's own API.

You can delete this data at any time by removing the relevant files.

## Third-party AI providers (where your content goes)

Amicus's core purpose is to route your prompts and context to AI models. When
you run a council, a fork, or a fan-out, the content you provide — which may
include prompts, source code, documents, and prior conversation — is sent, using
**your** API keys, to whichever providers you have configured. That content is
then subject to each provider's own privacy policy and data-usage terms.

Common providers and their policies:

- **OpenAI** (GPT) — <https://openai.com/policies/privacy-policy>
- **Google** (Gemini) — <https://policies.google.com/privacy>
- **Anthropic** (Claude) — <https://www.anthropic.com/legal/privacy>
- **DeepSeek** — <https://www.deepseek.com/>
- **OpenRouter** (gateway to many models) — <https://openrouter.ai/privacy>
- **Any other provider you configure** — refer to that provider's policy.

If you use a **local** model provider (for example, Ollama), the content sent to
that provider stays on your own machine and is not transmitted to any third
party.

You are responsible for reviewing and accepting the terms of the providers you
enable, and for not sending a provider data you are not permitted to share.

## Update checks

Amicus uses the `update-notifier` library to check the public **npm registry**
for a newer released version. That request goes to npm — not to the author — and
does not include your prompts or personal data. You can disable it by setting the
environment variable `NO_UPDATE_NOTIFIER=1`.

## Children's privacy

Amicus is a developer tool, is not directed to children under 13, and does not
knowingly collect information from anyone.

## Changes to this policy

This policy may be updated as Amicus evolves. Changes are published in this file
in the repository, and the effective date above is updated accordingly.

## Contact

Questions or concerns? Open an issue at
<https://github.com/BourbonDog/amicus/issues>.
