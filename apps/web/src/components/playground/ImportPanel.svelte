<script lang="ts">
  import { useTranslations } from '../../i18n';
  import type { Playground } from '../../lib/playground.svelte.ts';
  import {
    defaultColumns,
    MAX_POINTS,
    MAX_TEXT,
    parseTable,
    pointsFrom,
    type ImportResult,
    type Table,
  } from '../../lib/source.ts';
  import Icon from '../Icon.svelte';

  const { pg }: { pg: Playground } = $props();
  const t = useTranslations();

  let text = $state('');
  let table = $state.raw<Table | null>(null);
  let name = $state('');
  let xCol = $state(0);
  let yCol = $state(1);
  let result = $state.raw<ImportResult | null>(null);
  let error = $state('');
  let fileInput = $state<HTMLInputElement>();
  let dragging = $state(false);
  const PLACEHOLDER = ['x, y', '0, 1.2', '0.5, 1.9'].join('\n');

  function use(tbl: Table, from: string, cols = defaultColumns(tbl)) {
    [xCol, yCol] = cols;
    table = tbl;
    name = from;
    apply();
  }

  function apply() {
    if (!table) return;
    const r = pointsFrom(table, xCol, yCol);
    if (!r) {
      error = t('pg.import.error.fewRows');
      result = null;
      return;
    }
    error = '';
    result = r;
    pg.importPoints({ kind: 'points', xs: r.xs, ys: r.ys }, name);
  }

  function read(content: string, from: string) {
    const tbl = parseTable(content);
    if (typeof tbl === 'string') {
      error = t(`pg.import.error.${tbl}`, { max: '5 MB' });
      return;
    }
    use(tbl, from);
  }

  async function readFile(file: File) {
    if (file.size > MAX_TEXT) {
      error = t('pg.import.error.tooBig', { max: '5 MB' });
      return;
    }
    try {
      read(await file.text(), file.name);
    } catch {
      error = t('pg.import.error.unreadable');
    }
  }

  const colLabel = (i: number) =>
    table?.header ? (table.columns[i] ?? `${i + 1}`) : t('pg.import.column', { n: i + 1 });
</script>

<div
  class="flex flex-col gap-2.5 text-[13px] {dragging ? 'rounded-lg outline-2 outline-accent' : ''}"
  role="group"
  aria-label={t('pg.tab.data')}
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={(e) => {
    e.preventDefault();
    dragging = false;
    const f = e.dataTransfer?.files[0];
    if (f) void readFile(f);
  }}
  data-import-panel
>
  <p class="text-muted">{t('pg.import.intro', { max: MAX_POINTS.toLocaleString('en') })}</p>
  <div class="flex flex-wrap gap-2">
    <button type="button" class="xp-btn min-h-10 px-3" onclick={() => fileInput?.click()}
      ><Icon name="upload" size={16} />{t('pg.import.file')}</button
    >
    <input
      bind:this={fileInput}
      type="file"
      accept=".csv,.tsv,.txt,text/csv,text/plain"
      class="hidden"
      data-import-file
      onchange={(e) => {
        const f = e.currentTarget.files?.[0];
        if (f) void readFile(f);
        e.currentTarget.value = '';
      }}
    />
  </div>
  <label class="flex flex-col gap-1">
    <span class="xp-label">{t('pg.import.paste')}</span>
    <textarea
      class="xp-input min-h-24 py-2 font-mono text-[12.5px]"
      placeholder={PLACEHOLDER}
      spellcheck="false"
      bind:value={text}
      data-import-text></textarea>
  </label>
  <button
    type="button"
    class="xp-btn min-h-10 self-start px-3"
    disabled={!text.trim()}
    onclick={() => read(text, t('pg.import.pasted'))}
    data-import-use>{t('pg.import.use')}</button
  >

  {#if error}
    <p class="flex gap-2 text-bad" role="alert" data-import-error>
      <Icon name="alert" size={16} />{error}
    </p>
  {/if}

  {#if table && table.columns.length > 1}
    <div class="grid grid-cols-2 gap-2">
      <label class="flex flex-col gap-1"
        ><span class="xp-label">{t('pg.import.x')}</span>
        <select
          class="xp-input"
          value={xCol}
          onchange={(e) => {
            xCol = Number(e.currentTarget.value);
            apply();
          }}
        >
          <option value={-1}>{t('pg.import.rowNumber')}</option>
          {#each table.columns as _c, i (i)}<option value={i}>{colLabel(i)}</option>{/each}
        </select>
      </label>
      <label class="flex flex-col gap-1"
        ><span class="xp-label">{t('pg.import.y')}</span>
        <select
          class="xp-input"
          value={yCol}
          onchange={(e) => {
            yCol = Number(e.currentTarget.value);
            apply();
          }}
        >
          {#each table.columns as _c, i (i)}<option value={i}>{colLabel(i)}</option>{/each}
        </select>
      </label>
    </div>
  {/if}

  {#if pg.imported}
    <div class="flex flex-col gap-1 rounded-lg bg-surface-2 px-2.5 py-2 text-xs" data-import-status>
      <p class="font-semibold text-ink">
        {t('pg.import.loaded', {
          count: pg.imported.xs.length,
          name: pg.importedName || t('pg.import.fromLink'),
        })}
      </p>
      {#if result?.dropped}<p class="text-muted">
          {t('pg.import.dropped', { count: result.dropped })}
        </p>{/if}
      {#if result?.thinnedFrom}<p class="text-muted">
          {t('pg.import.thinned', {
            from: result.thinnedFrom.toLocaleString('en'),
            max: MAX_POINTS.toLocaleString('en'),
          })}
        </p>{/if}
      <p class="text-muted">{t('pg.import.noTruth')}</p>
    </div>
  {/if}
</div>
