/**
 * Third-party notices.
 *
 * As an Astro integration: collects every npm package whose code or assets end
 * up in the shipped site, checks each license against an allowlist (failing the
 * build otherwise) and writes dist/THIRD_PARTY.md (summary table + full texts).
 * Shipped = client JS chunks + emitted assets (CSS, fonts, images) of every
 * build environment; server-side prerender chunks never reach visitors.
 *
 * As a script (`node scripts/notices.ts --check | --update`): compares the
 * generated file with THIRD_PARTY.md at the repository root, or copies it there.
 */
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import type { Plugin } from 'vite';

export const NOTICES_FILE = 'THIRD_PARTY.md';

export interface ExtraNotice {
  name: string;
  label?: string;
  version?: string;
  license: string;
  homepage?: string;
  text: string;
}

export interface NoticesOptions {
  /** SPDX identifiers that may ship. */
  allow: string[];
  /** Packages that ship without appearing as bundle files (inlined runtimes, generated CSS). */
  alwaysInclude?: string[];
  /** Friendly names for the summary table, by package name. */
  labels?: Record<string, string>;
  /** Non-npm material (ported algorithms, data, etc.). */
  extras?: ExtraNotice[];
}

export interface PackageInfo {
  name: string;
  label?: string;
  version: string;
  license: string;
  homepage: string;
  text: string;
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|ofl)([.-].*)?$/i;
const IN_NODE_MODULES = /[\\/]node_modules[\\/]/;

function findPackageRoot(file: string): string | undefined {
  let dir = dirname(file);
  for (let i = 0; i < 16; i++) {
    const pj = join(dir, 'package.json');
    if (existsSync(pj)) {
      try {
        const json = JSON.parse(readFileSync(pj, 'utf8')) as { name?: string; version?: string };
        if (json.name && json.version) return dir;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function cleanUrl(raw: string): string {
  return raw
    .replace(/^git\+/, '')
    .replace(/^github:/, 'https://github.com/')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
}

function readPackage(root: string): PackageInfo {
  const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    license?: string | { type?: string };
    homepage?: string;
    repository?: string | { url?: string };
  };
  const license =
    typeof json.license === 'string' ? json.license : (json.license?.type ?? 'UNKNOWN');
  const repo = typeof json.repository === 'string' ? json.repository : json.repository?.url;
  const homepage = cleanUrl(json.homepage ?? repo ?? `https://www.npmjs.com/package/${json.name}`);
  const text = readdirSync(root)
    .filter((f) => LICENSE_FILE.test(f))
    .sort()
    .map((f) => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n').trim())
    .join('\n\n');
  return { name: json.name, version: json.version, license, homepage, text };
}

/** Tiny SPDX expression evaluator: OR, AND, parentheses, trailing "+". */
export function licenseAllowed(expr: string, allow: ReadonlySet<string>): boolean {
  const tokens = expr.replace(/[()]/g, ' $& ').trim().split(/\s+/);
  let pos = 0;
  const primary = (): boolean => {
    const tok = tokens[pos++];
    if (tok === '(') {
      const v = or();
      pos++; // ')'
      return v;
    }
    return tok !== undefined && allow.has(tok.replace(/\+$/, ''));
  };
  const and = (): boolean => {
    let v = primary();
    while (tokens[pos] === 'AND') {
      pos++;
      v = primary() && v;
    }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (tokens[pos] === 'OR') {
      pos++;
      v = and() || v;
    }
    return v;
  };
  return or();
}

const cell = (s: string) => s.replace(/\|/g, '\\|');

export function renderNotices(packages: PackageInfo[], extras: ExtraNotice[]): string {
  const entries = [...packages, ...extras].sort((a, b) =>
    (a.label ?? a.name).localeCompare(b.label ?? b.name, 'en'),
  );
  const rows = entries.map(
    (e) =>
      `| ${cell(e.label ?? e.name)} | ${e.version ?? ''} | ${cell(e.license)} | ${e.homepage ? `<${e.homepage}>` : ''} |`,
  );
  const texts = entries.map((e) =>
    [
      `### ${e.name}${e.version ? ` ${e.version}` : ''}`,
      '',
      '````text',
      e.text || `This package includes no license file. License: ${e.license}.`,
      '````',
    ].join('\n'),
  );
  return [
    '# Third-party notices',
    '',
    'Xtraplaytion includes the third-party software and fonts listed below. Each remains under its own license; the KFA Source-Available License does not apply to them. This file is generated from the files the website actually ships.',
    '',
    '| Component | Version | License | Source |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## License texts',
    '',
    texts.join('\n\n'),
    '',
  ].join('\n');
}

export function thirdPartyNotices(options: NoticesOptions): AstroIntegration {
  const allow = new Set(options.allow);
  const roots = new Set<string>();

  const collector: Plugin = {
    name: 'xp-third-party-notices',
    apply: 'build',
    generateBundle(_out, bundle) {
      const env = this.environment;
      const add = (id: string) => {
        const abs = resolve(env.config.root, id.replace(/^\0/, '').replace(/[?#].*$/, ''));
        if (!IN_NODE_MODULES.test(abs)) return;
        const root = findPackageRoot(abs);
        if (root) roots.add(realpathSync(root));
      };
      for (const item of Object.values(bundle)) {
        if (item.type === 'asset') {
          for (const f of item.originalFileNames) add(f);
        } else if (env.name === 'client') {
          for (const id of Object.keys(item.modules)) add(id);
        }
      }
    },
  };

  return {
    name: 'xp-third-party-notices',
    hooks: {
      'astro:config:setup': ({ updateConfig, command }) => {
        if (command === 'build') updateConfig({ vite: { plugins: [collector] } });
      },
      'astro:build:done': ({ dir, logger }) => {
        for (const name of options.alwaysInclude ?? []) {
          const pj = join(process.cwd(), 'node_modules', name, 'package.json');
          if (!existsSync(pj)) throw new Error(`Notices: cannot find package ${name}`);
          roots.add(realpathSync(dirname(pj)));
        }
        const byKey = new Map<string, PackageInfo>();
        for (const root of roots) {
          const info = readPackage(root);
          const label = options.labels?.[info.name];
          byKey.set(`${info.name}@${info.version}`, label ? { ...info, label } : info);
        }
        const packages = [...byKey.values()];
        const bad = packages.filter((p) => !licenseAllowed(p.license, allow));
        if (bad.length) {
          throw new Error(
            `Disallowed licenses in shipped files: ${bad.map((p) => `${p.name}@${p.version} (${p.license})`).join(', ')}`,
          );
        }
        writeFileSync(
          join(fileURLToPath(dir), NOTICES_FILE),
          renderNotices(packages, options.extras ?? []),
        );
        logger.info(`${NOTICES_FILE}: ${packages.length + (options.extras?.length ?? 0)} entries`);
      },
    },
  };
}

// CLI: node scripts/notices.ts --check | --update
if (import.meta.main) {
  const generated = fileURLToPath(new URL(`../dist/${NOTICES_FILE}`, import.meta.url));
  const committed = fileURLToPath(new URL(`../../../${NOTICES_FILE}`, import.meta.url));
  const norm = (s: string) => s.replace(/\r\n/g, '\n');
  if (!existsSync(generated)) {
    console.error('No generated notices found. Run `pnpm build` first.');
    process.exit(1);
  }
  if (process.argv.includes('--update')) {
    copyFileSync(generated, committed);
    console.log(`${NOTICES_FILE} updated.`);
  } else if (
    !existsSync(committed) ||
    norm(readFileSync(committed, 'utf8')) !== norm(readFileSync(generated, 'utf8'))
  ) {
    console.error(`${NOTICES_FILE} is out of date. Run \`pnpm build && pnpm notices:update\`.`);
    process.exit(1);
  } else {
    console.log(`${NOTICES_FILE} is up to date.`);
  }
}
