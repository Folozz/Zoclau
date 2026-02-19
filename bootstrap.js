/* eslint-disable no-undef */
/* global Components, Services, Zotero, APP_SHUTDOWN */

/**
 * Zoclau - Zotero 7 Bootstrap Entry Point
 *
 * Based on the official Zotero plugin template pattern:
 * https://github.com/windingwind/zotero-plugin-template
 *
 * Lifecycle hooks: startup -> onMainWindowLoad -> onMainWindowUnload -> shutdown
 */

var chromeHandle;
var loadedWindows = new WeakSet();

function install(data, reason) { }

function zoclauLog(message) {
    try {
        var file = Services.dirsvc.get("ProfD", Components.interfaces.nsIFile);
        file.append("zoclau-debug.log");

        var foStream = Components.classes["@mozilla.org/network/file-output-stream;1"]
            .createInstance(Components.interfaces.nsIFileOutputStream);
        // write | create | append
        foStream.init(file, 0x02 | 0x08 | 0x10, 420, 0);

        var converter = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
            .createInstance(Components.interfaces.nsIConverterOutputStream);
        converter.init(foStream, "UTF-8", 0, 0);
        converter.writeString(new Date().toISOString() + " " + message + "\n");
        converter.close();
    } catch (e) {
        try {
            Services.console.logStringMessage("[Zoclau] log failure: " + e);
        } catch {
            // ignore
        }
    }
}

function formatError(err) {
    if (!err) return "unknown error";
    try {
        var stack = err.stack ? ("\n" + err.stack) : "";
        return String(err) + stack;
    } catch {
        return String(err);
    }
}

function getPluginModule() {
    if (!Zotero) return null;
    return Zotero.Zoclau || Zotero.ZeClau || null;
}

function handleWindowLoad(window, reason) {
    if (!window) return;
    if (loadedWindows.has(window)) return;
    loadedWindows.add(window);
    var plugin = getPluginModule();
    if (plugin && plugin.onMainWindowLoad) {
        plugin.onMainWindowLoad(window);
        zoclauLog("onMainWindowLoad handler executed (manual)");
    } else {
        zoclauLog("onMainWindowLoad skipped (missing handler, manual)");
    }
}

async function startup({ id, version, resourceURI, rootURI }, reason) {
    zoclauLog("startup begin reason=" + reason + " rootURI=" + rootURI);
    try {
        // Register chrome so we can use chrome:// URIs for content
        var aomStartup = Components.classes[
            "@mozilla.org/addons/addon-manager-startup;1"
        ].getService(Components.interfaces.amIAddonManagerStartup);
        var manifestURI = Services.io.newURI(rootURI + "manifest.json");
        chromeHandle = aomStartup.registerChrome(manifestURI, [
            ["content", "zoclau", rootURI + "content/"],
        ]);
        zoclauLog("startup chrome registered");

        // Load the main plugin script through chrome:// for packed/unpacked compatibility
        Services.scriptloader.loadSubScript("chrome://zoclau/content/zoclau.js");
        if (Zotero && Zotero.Zoclau && !Zotero.ZeClau) {
            Zotero.ZeClau = Zotero.Zoclau;
        }
        var plugin = getPluginModule();
        zoclauLog(
            "startup subscript loaded, has Zotero.Zoclau=" +
            !!(Zotero && Zotero.Zoclau) +
            " has Zotero.ZeClau=" +
            !!(Zotero && Zotero.ZeClau)
        );

        // Initialize plugin (non-window tasks: register prefs, detect CLI, etc.)
        if (plugin && plugin.init) {
            await plugin.init({ id, version, rootURI });
            zoclauLog("startup init completed");
        } else {
            zoclauLog("startup init skipped (missing plugin.init)");
        }

        // At app startup, the main window can already be open before this addon finishes loading.
        // Call onMainWindowLoad for existing browser windows to ensure UI is mounted.
        try {
            var windows = Services.wm.getEnumerator("navigator:browser");
            while (windows.hasMoreElements()) {
                var win = windows.getNext();
                handleWindowLoad(win, reason);
            }
        } catch (e2) {
            zoclauLog("startup existing-window pass failed: " + formatError(e2));
        }
    } catch (e) {
        zoclauLog("startup error: " + formatError(e));
        throw e;
    }
}

// Called automatically by Zotero 7 when the main window is loaded
async function onMainWindowLoad({ window }, reason) {
    zoclauLog("onMainWindowLoad reason=" + reason);
    try {
        handleWindowLoad(window, reason);
    } catch (e) {
        zoclauLog("onMainWindowLoad error: " + formatError(e));
        throw e;
    }
}

// Called automatically by Zotero 7 when the main window is unloaded
async function onMainWindowUnload({ window }, reason) {
    zoclauLog("onMainWindowUnload reason=" + reason);
    try {
        if (window && loadedWindows.has(window)) {
            loadedWindows.delete(window);
        }
        var plugin = getPluginModule();
        if (plugin && plugin.onMainWindowUnload) {
            plugin.onMainWindowUnload(window);
            zoclauLog("onMainWindowUnload handler executed");
        } else {
            zoclauLog("onMainWindowUnload skipped (missing handler)");
        }
    } catch (e) {
        zoclauLog("onMainWindowUnload error: " + formatError(e));
        throw e;
    }
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
    zoclauLog("shutdown begin reason=" + reason);
    if (reason === APP_SHUTDOWN) {
        return;
    }

    try {
        var plugin = getPluginModule();
        if (plugin && plugin.shutdown) {
            plugin.shutdown();
            zoclauLog("shutdown handler executed");
        }

        Zotero.Zoclau = undefined;
        Zotero.ZeClau = undefined;

        if (chromeHandle) {
            chromeHandle.destruct();
            chromeHandle = null;
            zoclauLog("shutdown chrome handle destructed");
        }
    } catch (e) {
        zoclauLog("shutdown error: " + formatError(e));
        throw e;
    }
}

function uninstall(data, reason) { }


