import * as vscode from 'vscode';
import * as https from 'https';

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  name?: string;
  body?: string;
  assets?: GitHubReleaseAsset[];
}

export class UpdateService {
  private readonly context: vscode.ExtensionContext;
  private readonly currentVersion: string;
  private readonly repoOwner = 'byrdchermit';
  private readonly repoName = 'byrdsnest-api-client';
  private readonly lastCheckKey = 'bluebyrd.lastUpdateCheck';
  private readonly checkIntervalMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    const pkg = context.extension?.packageJSON;
    this.currentVersion = pkg?.version || '0.1.0';
  }

  public getCurrentVersion(): string {
    return this.currentVersion;
  }

  /**
   * Compares two semantic version strings (e.g., '0.2.0' vs '0.1.0').
   * Returns true if remote is strictly newer than current.
   */
  public static isNewerVersion(remote: string, current: string): boolean {
    const clean = (v: string) => v.replace(/^v/i, '').trim().split('-')[0];
    const rParts = clean(remote).split('.').map((p) => parseInt(p, 10) || 0);
    const cParts = clean(current).split('.').map((p) => parseInt(p, 10) || 0);

    const maxLen = Math.max(rParts.length, cParts.length);
    for (let i = 0; i < maxLen; i++) {
      const r = rParts[i] ?? 0;
      const c = cParts[i] ?? 0;
      if (r > c) return true;
      if (r < c) return false;
    }
    return false;
  }

  /**
   * Fetches latest release metadata from GitHub public API.
   */
  public async fetchLatestRelease(): Promise<GitHubRelease | null> {
    return new Promise<GitHubRelease | null>((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.repoOwner}/${this.repoName}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': 'byrdsnest-vscode-extension',
          Accept: 'application/vnd.github.v3+json',
        },
        timeout: 6000,
      };

      const req = https.request(options, (res) => {
        let data = '';

        if (res.statusCode === 404) {
          // No releases published yet
          resolve(null);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
          return;
        }

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as GitHubRelease;
            resolve(parsed);
          } catch (e: any) {
            reject(new Error(`Failed to parse release response: ${e.message}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Update check request timed out'));
      });

      req.end();
    });
  }

  /**
   * Checks for available updates.
   * @param manual If true, ignores 24h throttling and shows up-to-date/error notifications.
   */
  public async checkForUpdates(manual = false): Promise<boolean> {
    const lastCheck = this.context.globalState.get<number>(this.lastCheckKey) || 0;
    const now = Date.now();

    if (!manual && now - lastCheck < this.checkIntervalMs) {
      return false; // Throttled for background checks
    }

    try {
      const release = await this.fetchLatestRelease();
      await this.context.globalState.update(this.lastCheckKey, now);

      if (!release || !release.tag_name) {
        if (manual) {
          vscode.window.showInformationMessage(`byrdsnest api client is up to date (v${this.currentVersion}).`);
        }
        return false;
      }

      const remoteTag = release.tag_name;
      const hasUpdate = UpdateService.isNewerVersion(remoteTag, this.currentVersion);

      if (hasUpdate) {
        const cleanTag = remoteTag.replace(/^v/i, '');
        const vsixAsset = release.assets?.find((a) => a.name.toLowerCase().endsWith('.vsix'));
        const downloadUrl = vsixAsset?.browser_download_url || release.html_url;

        const choice = await vscode.window.showInformationMessage(
          `A new version of byrdsnest api client is available: v${cleanTag} (installed: v${this.currentVersion}).`,
          'Download Update',
          'View Changelog',
          'Later'
        );

        if (choice === 'Download Update' && downloadUrl.startsWith('https://')) {
          vscode.env.openExternal(vscode.Uri.parse(downloadUrl));
        } else if (choice === 'View Changelog' && release.html_url?.startsWith('https://')) {
          vscode.env.openExternal(vscode.Uri.parse(release.html_url));
        }
        return true;
      } else {
        if (manual) {
          vscode.window.showInformationMessage(`byrdsnest api client is up to date (v${this.currentVersion}).`);
        }
        return false;
      }
    } catch (err: any) {
      if (manual) {
        vscode.window.showWarningMessage(`Could not check for updates: ${err?.message || 'Network error'}`);
      } else {
        console.warn('[byrdsnest api client] Background update check failed:', err?.message);
      }
      return false;
    }
  }
}
