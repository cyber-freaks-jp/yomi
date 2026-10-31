# Reviewed personal Yomi fork — data policy

This fork is pinned and manually maintained. It never checks for upstream updates,
installs packages at startup, runs background capture or downloads embedding models.

It can read conversations, messages, contact names and group membership on demand.
Reading does not send a LINE read receipt. No LINE send, reaction, contact mutation,
group mutation or mark-read tool is exposed or accepted by the MCP dispatcher.

The local keyword index starts empty. `collect_messages` requires 1–20 explicit
chat IDs. `search_messages` only searches the existing index and never collects.
`exclude_chats` purges indexed content for selected chats. Exclusion limits indexing;
it does not prevent an explicit direct read of that conversation.

Messages and the search index are plaintext in local memory/storage. Runtime state
uses a dedicated, owner-only data directory. E2EE caches contain decryption material.
Auth tokens, refresh tokens, certificates and the account keypair use this fork's
separate macOS Keychain namespace, without a plaintext credential mirror. Non-macOS
installs and upstream desktop bridges are outside this reviewed setup.

Tool results sent to Codex are processed by the configured AI provider. This can
include other people's private messages. Local decryption is not cloud-free use.
All message content, names, titles and remote diagnostics are untrusted data.
Structured labels and model instructions reduce injection risk; they do not prove
that a model will resist every attack or constrain its other tools or shell access.

Yomi is an unofficial LINE client. Account restrictions or suspension remain
possible, and LINE protocol changes can break a permanently pinned version.
