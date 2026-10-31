import { expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CredentialStore } from './credential-store.js'

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'yomi-reviewed-credentials-'))
  const path = join(dir, 'line.json')
  const store = new CredentialStore('test-only', path)
  let saved: string | null = null
  store.secureStorageEnabled = true
  store.keychainService = {
    getCredential: async () =>
      saved === null
        ? { success: false, error: 'Credential not found' }
        : { success: true, password: saved },
    setCredential: async (_account: string, blob: string) => {
      saved = blob
      return { success: true }
    },
  }
  return { store, path }
}

test('secure credentials persist only in mocked Keychain, never to a JSON mirror', async () => {
  const { store, path } = await fixture()
  await store.set('line_auth_token', 'test-token')
  expect(await store.get('line_auth_token')).toBe('test-token')
  expect(await readFile(path, 'utf8').catch(() => null)).toBeNull()
})

test('secure reads ignore stale plaintext credentials', async () => {
  const { store, path } = await fixture()
  await writeFile(path, JSON.stringify({ line_auth_token: 'stale-plaintext' }))
  expect(await store.get('line_auth_token')).toBeNull()
})

test('Keychain failures are visible, leave no plaintext, and do not poison later saves', async () => {
  const { store, path } = await fixture()
  const original = store.keychainService.setCredential
  store.keychainService.setCredential = async () => ({ success: false })
  await expect(store.set('line_auth_token', 'test-token')).rejects.toThrow(
    'persist',
  )
  expect(await readFile(path, 'utf8').catch(() => null)).toBeNull()
  store.keychainService.setCredential = original
  await store.set('line_auth_token', 'recovered-token')
  expect(await store.get('line_auth_token')).toBe('recovered-token')
})
