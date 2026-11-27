import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface SecretVault {
  setApiKey(apiKey: string, mode: 'memory' | 'dpapi'): void;
  getApiKey(): string | null;
  clearApiKey(): void;
  hasApiKey(): boolean;
  getStorageMode(): 'memory' | 'dpapi';
}

/**
 * Stores API keys strictly in process memory or Windows DPAPI-encrypted file
 * (`data/.secrets.dpapi`). Never writes plaintext keys to SQLite, Markdown, backups, or logs.
 */
export class LocalSecretVault implements SecretVault {
  private memoryKey: string | null = null;
  private mode: 'memory' | 'dpapi' = 'memory';
  private readonly dpapiPath: string;

  constructor(dataDir: string) {
    this.dpapiPath = path.join(dataDir, '.secrets.dpapi');
    if (fs.existsSync(this.dpapiPath)) {
      const loaded = this.readDpapi();
      if (loaded) {
        this.memoryKey = loaded;
        this.mode = 'dpapi';
      }
    }
  }

  public setApiKey(apiKey: string, mode: 'memory' | 'dpapi') {
    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error('API key cannot be empty');

    if (mode === 'dpapi' && process.platform === 'win32') {
      this.writeDpapi(trimmed);
      this.memoryKey = trimmed;
      this.mode = 'dpapi';
      return;
    }

    this.memoryKey = trimmed;
    if (fs.existsSync(this.dpapiPath)) {
      fs.rmSync(this.dpapiPath, { force: true });
    }
    this.mode = 'memory';
  }

  public getApiKey(): string | null {
    return this.memoryKey;
  }

  public clearApiKey(): void {
    this.memoryKey = null;
    this.mode = 'memory';
    if (fs.existsSync(this.dpapiPath)) {
      fs.rmSync(this.dpapiPath, { force: true });
    }
  }

  public hasApiKey(): boolean {
    return Boolean(this.memoryKey);
  }

  public getStorageMode(): 'memory' | 'dpapi' {
    return this.mode;
  }

  private writeDpapi(plaintext: string) {
    fs.mkdirSync(path.dirname(this.dpapiPath), { recursive: true });
    const b64 = Buffer.from(plaintext, 'utf8').toString('base64');
    const script = `
      Add-Type -AssemblyName System.Security
      $b64 = [Console]::In.ReadToEnd().Trim()
      $bytes = [Convert]::FromBase64String($b64)
      $protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [IO.File]::WriteAllBytes($env:ATLAS_SECRET_PATH, $protected)
    `;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, ATLAS_SECRET_PATH: this.dpapiPath },
      input: b64,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      windowsHide: true,
    });
  }

  private readDpapi(): string | null {
    if (process.platform !== 'win32' || !fs.existsSync(this.dpapiPath)) return null;
    try {
      const script = `
        Add-Type -AssemblyName System.Security
        $protected = [IO.File]::ReadAllBytes($env:ATLAS_SECRET_PATH)
        $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        [Convert]::ToBase64String($bytes)
      `;
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, ATLAS_SECRET_PATH: this.dpapiPath },
        stdio: 'pipe',
        timeout: 15000,
        windowsHide: true,
      })
        .toString('utf8')
        .trim();
      return Buffer.from(out, 'base64').toString('utf8');
    } catch {
      console.warn('[LocalSecretVault] Failed to decrypt DPAPI secret file; starting without persisted API key.');
      return null;
    }
  }
}
