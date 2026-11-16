'use server'

import { cookies, headers } from 'next/headers'
import { getNeonClient } from 'util/db/neon/client'
import { createNeonSettingsBackupStore } from 'util/settingsBackup/neonStore'
import {
  authorizeSettingsBackup as authorizeWithDeps,
  createSettingsBackupLimits,
  createSettingsBackup as createWithDeps,
  deleteSettingsBackup as deleteWithDeps,
  getSettingsBackup as getWithDeps,
  listSettingsBackups as listWithDeps,
  type SettingsBackupCookieJar,
  type SettingsBackupDeps,
  getSettingsBackupStatus as statusWithDeps,
} from 'util/settingsBackup/service'

const limits = createSettingsBackupLimits()

async function callerKey(): Promise<string> {
  const headerList = await headers()
  const realIp = headerList.get('x-real-ip')?.trim()
  if (realIp) return realIp
  const hops =
    headerList
      .get('x-forwarded-for')
      ?.split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0) ?? []
  return hops.at(-1) ?? 'local'
}

async function buildDeps(): Promise<SettingsBackupDeps> {
  const jar = await cookies()
  const cookiesAdapter: SettingsBackupCookieJar = {
    get(name) {
      const value = jar.get(name)?.value
      return value == null ? undefined : { value }
    },
    set(name, value, options) {
      jar.set(name, value, options)
    },
  }
  const client = getNeonClient()
  return {
    callerKey: await callerKey(),
    cookies: cookiesAdapter,
    databaseUrl: process.env.DATABASE_URL,
    fetch,
    limits,
    now: () => Date.now(),
    store: client == null ? null : createNeonSettingsBackupStore(client),
  }
}

export async function authorizeSettingsBackup(
  backend: unknown,
  backendUrl: unknown,
  accessToken: unknown,
) {
  return authorizeWithDeps(backend, backendUrl, accessToken, await buildDeps())
}

export async function getSettingsBackupStatus() {
  return statusWithDeps(await buildDeps())
}

export async function listSettingsBackups() {
  return listWithDeps(await buildDeps())
}

export async function createSettingsBackup(envelope: unknown) {
  return createWithDeps(envelope, await buildDeps())
}

export async function getSettingsBackup(id: unknown) {
  return getWithDeps(id, await buildDeps())
}

export async function deleteSettingsBackup(id: unknown) {
  return deleteWithDeps(id, await buildDeps())
}
