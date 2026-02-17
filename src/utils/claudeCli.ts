/**
 * Claude CLI path detection utilities.
 * Uses Zotero/Mozilla APIs instead of Node.js fs/path/os.
 */

declare const Zotero: any;
declare const Components: any;

function fileExists(path: string): boolean {
    if (!path) return false;
    try {
        const file = Components.classes['@mozilla.org/file/local;1']
            .createInstance(Components.interfaces.nsIFile);
        file.initWithPath(path);
        return file.exists() && file.isFile();
    } catch {
        return false;
    }
}

function addCliCandidatesFromPath(
    set: Set<string>,
    pathVar: string,
    isWindows: boolean,
): void {
    const sep = isWindows ? ';' : ':';

    for (const rawDir of pathVar.split(sep)) {
        const dir = rawDir.trim().replace(/^"|"$/g, '');
        if (!dir) continue;

        if (isWindows) {
            set.add(`${dir}\\claude.exe`);
            set.add(`${dir}\\claude.cmd`);
            set.add(`${dir}\\claude.bat`);
            continue;
        }

        set.add(`${dir}/claude`);
    }
}

/**
 * Try to find the Claude CLI binary on the system.
 * Uses Zotero's file APIs instead of Node.js builtins.
 */
export function findClaudeCli(): string | null {
    try {
        const env = Components.classes['@mozilla.org/process/environment;1']
            .getService(Components.interfaces.nsIEnvironment);
        const isWindows = env.get('OS')?.includes('Windows') ||
            env.get('COMSPEC')?.length > 0;

        const candidates = new Set<string>();

        if (isWindows) {
            const localAppData = env.get('LOCALAPPDATA') || '';
            const appData = env.get('APPDATA') || '';
            const userProfile = env.get('USERPROFILE') || '';

            if (localAppData) {
                candidates.add(localAppData + '\\Claude\\claude.exe');
                candidates.add(localAppData + '\\Programs\\Claude\\claude.exe');
            }
            if (appData) {
                candidates.add(appData + '\\npm\\claude.cmd');
                candidates.add(appData + '\\npm\\claude.exe');
            }
            if (userProfile) {
                candidates.add(userProfile + '\\.local\\bin\\claude.exe');
                candidates.add(userProfile + '\\.local\\bin\\claude.cmd');
            }

            addCliCandidatesFromPath(candidates, env.get('PATH') || '', true);
        } else {
            const home = env.get('HOME') || '';
            candidates.add('/usr/local/bin/claude');
            candidates.add('/usr/bin/claude');
            candidates.add('/opt/homebrew/bin/claude');
            if (home) {
                candidates.add(home + '/.local/bin/claude');
                candidates.add(home + '/.npm-global/bin/claude');
                candidates.add(home + '/.volta/bin/claude');
            }

            addCliCandidatesFromPath(candidates, env.get('PATH') || '', false);
        }

        for (const candidate of candidates) {
            if (fileExists(candidate)) {
                return candidate;
            }
        }
    } catch (e) {
        Zotero.debug(`[Zoclau] CLI detection error: ${e}`);
    }

    return null;
}
