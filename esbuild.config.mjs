import esbuild from 'esbuild';
import path from 'path';
import process from 'process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const prod = process.argv[2] === 'production';

// Ensure build output directories exist
const buildDirs = [
    'build/addon',
    'build/addon/content',
    'build/addon/content/icons',
];
for (const dir of buildDirs) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

// Copy static files to build output
function copyStaticFiles() {
    const copies = [
        ['manifest.json', 'build/addon/manifest.json'],
        ['bootstrap.js', 'build/addon/bootstrap.js'],
        ['prefs.js', 'build/addon/prefs.js'],
        ['content/preferences.xhtml', 'build/addon/content/preferences.xhtml'],
        ['content/preferences.js', 'build/addon/content/preferences.js'],
        ['content/zeclau.css', 'build/addon/content/zeclau.css'],
        ['content/icons/zoclau-16.png', 'build/addon/content/icons/zoclau-16.png'],
        ['content/icons/zoclau-48.png', 'build/addon/content/icons/zoclau-48.png'],
        ['content/icons/zoclau-96.png', 'build/addon/content/icons/zoclau-96.png'],
    ];

    for (const [src, dest] of copies) {
        if (existsSync(src)) {
            const destDir = path.dirname(dest);
            if (!existsSync(destDir)) {
                mkdirSync(destDir, { recursive: true });
            }
            copyFileSync(src, dest);
                        console.log(`Copied ${src} -> ${dest}`);
        }
    }
}

const copyPlugin = {
    name: 'copy-static',
    setup(build) {
        build.onEnd((result) => {
            if (result.errors.length > 0) return;
            copyStaticFiles();
        });
    },
};

const context = await esbuild.context({
    entryPoints: ['src/index.ts'],
    bundle: true,
    plugins: [copyPlugin],
    external: [],
    format: 'iife',
    globalName: '_ZeClauModule',
    target: 'firefox115',
    logLevel: 'info',
    sourcemap: prod ? false : 'inline',
    treeShaking: true,
    outfile: 'build/addon/content/zeclau.js',
    banner: {
        js: `// Zoclau - Claude Code for Zotero\n// Built: ${new Date().toISOString()}\n`,
    },
    footer: {
        js: `\n// Register on Zotero global\nif (typeof Zotero !== 'undefined') { Zotero.ZeClau = _ZeClauModule; }\n`,
    },
    define: {
        'process.env.NODE_ENV': prod ? '"production"' : '"development"',
    },
});

if (prod) {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}

