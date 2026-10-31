/** Personal reviewed fork: fixed read-only MCP surface, no background tasks. */
import { type McpRequestContext, Server } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { isLineAuthInvalidatedError } from '../line/client/index.js'
import { LineProtocolService } from '../line/core/service.js'
import { YOMI_VERSION } from '../version.js'
import { clientCapabilitiesOf } from './client-capabilities.js'
import {
  handleFindContact,
  handleGetGroupMembers,
  handleListContacts,
} from './handlers/contacts.js'
import {
  handleGetChatMessages,
  handleGetUnreadDigest,
  handleListConversations,
} from './handlers/conversations.js'
import { handleLogin, handleLoginComplete } from './handlers/login.js'
import {
  handleExcludeChats,
  handleGetScopePolicy,
  handleIncludeChats,
  handleListExcludedChats,
} from './handlers/scope.js'
import {
  handleCollectMessages,
  handleSearchMessages,
} from './handlers/search.js'
import {
  sessionExpiredError,
  sessionRequiredError,
  sessionRevokedError,
  toolError,
} from './handlers/shared.js'
import {
  REVIEWED_INSTRUCTIONS,
  REVIEWED_TOOL_NAMES,
  validateReviewedCall,
  wrapReviewedResult,
} from './reviewed-policy.js'
import { TOOLS } from './tools.js'

const offline = new Set([
  'login',
  'login_complete',
  'search_messages',
  'exclude_chats',
  'include_chats',
  'list_excluded_chats',
  'get_scope_policy',
])

/** Build the server without starting capture, polling, model downloads or updates. */
async function main(): Promise<void> {
  process.umask(0o077)
  const service = new LineProtocolService()
  service.on('error', () => console.error('[Yomi] LINE service error'))
  await service.resumeSession()
  const selected = TOOLS.filter((tool) =>
    (REVIEWED_TOOL_NAMES as readonly string[]).includes(tool.name),
  ).map((tool) => ({
    ...tool,
    description:
      tool.name === 'collect_messages'
        ? 'Index recent messages from explicitly selected chatIds locally. Requires user intent to collect those chats. No all-chat collection or embeddings.'
        : tool.name === 'search_messages'
          ? 'Search the existing local keyword index. Does not fetch or collect messages.'
          : tool.description,
  }))

  const buildServer = ({ era }: McpRequestContext): Server => {
    const server = new Server(
      { name: 'yomi-reviewed', version: YOMI_VERSION },
      {
        capabilities: { tools: {} },
        instructions: REVIEWED_INSTRUCTIONS,
      },
    )
    server.setRequestHandler('tools/list', async () => ({ tools: selected }))
    server.setRequestHandler('tools/call', async (request, ctx) => {
      const { name } = request.params
      const args = (request.params.arguments ?? {}) as Record<string, any>
      try {
        validateReviewedCall(name, args)
        if (!offline.has(name)) {
          if (service.loginRequired)
            return service.loginReason === 'expired'
              ? sessionExpiredError()
              : sessionRevokedError()
          if (!service.client) return sessionRequiredError()
        }
        const dispatch = async () => {
          switch (name) {
            case 'login':
              return handleLogin(server, service, args, {
                era,
                capabilities: clientCapabilitiesOf(server, ctx),
                inputResponses: ctx.mcpReq.inputResponses,
              })
            case 'login_complete':
              return handleLoginComplete()
            case 'list_conversations':
              return handleListConversations(service, args)
            case 'get_chat_messages':
              return handleGetChatMessages(service, args as any)
            case 'get_unread_digest':
              return handleGetUnreadDigest(service, args)
            case 'find_contact':
              return handleFindContact(service, args as any)
            case 'list_contacts':
              return handleListContacts(service)
            case 'get_group_members':
              return handleGetGroupMembers(service, args as any)
            case 'collect_messages':
              return handleCollectMessages(service, args)
            case 'search_messages':
              return handleSearchMessages(service, args as any)
            case 'exclude_chats':
              return handleExcludeChats(args)
            case 'include_chats':
              return handleIncludeChats(args)
            case 'list_excluded_chats':
              return handleListExcludedChats(service)
            case 'get_scope_policy':
              return handleGetScopePolicy(service)
            default:
              return toolError('Tool disabled by reviewed fork policy.')
          }
        }
        return wrapReviewedResult(name, (await dispatch()) as any)
      } catch (error) {
        if (isLineAuthInvalidatedError(error)) {
          service.loginRequired = true
          service.loginReason = 'revoked'
          return sessionRevokedError()
        }
        // Remote error strings may contain sensitive or adversarial content too.
        return wrapReviewedResult(
          name,
          toolError(error instanceof Error ? error.message : 'Tool failed.'),
        )
      }
    })
    return server
  }
  serveStdio(buildServer, {
    legacy: 'serve',
    onerror: () => console.error('[Yomi] MCP protocol error'),
  })
}

main().catch(() => {
  console.error('[Yomi] Startup failed')
  process.exit(1)
})
