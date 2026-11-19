/**
 * Browser half of dsh-plugin-file.
 *
 * Contributes one sidebar panel entry and the page it selects. The page mirrors
 * the shape of the host's own connector page: a header with search and an
 * install action, then grouped rows of installed plugins.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-file',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** The sidebar entry id and the `main` slot key; they must match. */
    const PANEL_ID = 'file-plugins'
    const PANEL_ORDER = 30

    const TEXTS = {
      en: {
        'entry.label': 'File plugins',
        'page.title': 'Plugins',
        'page.subtitle': 'Connect a directory of Markdown and JSON so the agent can use it.',
        'page.search': 'Search plugins',
        'page.add': 'Add',
        'page.reading': 'Reading plugins…',
        'page.error': 'Could not read the plugin inventory',
        'group.installed': 'Installed',
        'group.markets': 'Marketplaces',
        'group.empty': 'No plugins here yet',
        'group.emptyHint': 'Plugins come from a marketplace: add one, then install from it.',
        'group.root': 'Plugin directory',
        'row.skills': 'skills',
        'row.agents': 'agents',
        'row.hooks': 'hooks',
        'row.empty': 'no entries',
        'add.title': 'Install from a link',
        'add.hint': 'GitHub repository, a GitHub subdirectory, or a direct .zip URL.',
        'add.placeholder': 'https://github.com/owner/repo',
        'add.action': 'Install',
        'add.working': 'Installing…',
        'add.cancel': 'Cancel',
        'add.ok': 'Installed',
        'add.failed': 'Install failed',
        'empty.none': 'No plugins matched',
        'market.add': 'Add marketplace',
        'market.addPlaceholder': 'https://github.com/owner/repo (a marketplace)',
        'market.adding': 'Adding…',
        'market.refresh': 'Refresh',
        'market.refreshing': 'Refreshing…',
        'market.remove': 'Remove',
        'market.count': 'plugins',
        'market.failed': 'Could not read this marketplace',
        'market.none': 'No marketplaces yet',
        'market.noneHint': 'Add a GitHub repository that holds a marketplace.json — the plugins it lists appear here.',
        'market.empty': 'This marketplace lists no installable plugins',
        'market.step': 'Step 1 · add a marketplace',
        'market.stepHint': 'A marketplace is one JSON file that lists plugins. Add its repository once; its plugins stay one click away.',
        'installed.step': 'Plugins come from a marketplace',
        'installed.stepHint': 'Open the Marketplaces tab and install from a source there.',
        'action.install': 'Install',
        'action.installed': 'Installed',
        'tabs.markets': 'Marketplaces',
        'tabs.installed': 'Installed',
        'update.available': 'Marketplace content changed',
        'update.detail': '{count} new plugin(s) available',
        'update.check': 'Check now',
        'update.checking': 'Checking…',
        'update.dismiss': 'Dismiss',
        'update.auto': 'Checked automatically',
      },
      zh: {
        'entry.label': '文件插件',
        'page.title': '插件',
        'page.subtitle': '连接一个 Markdown 和 JSON 目录，让智能体用上它。',
        'page.search': '搜索插件',
        'page.add': '添加',
        'page.reading': '正在读取插件…',
        'page.error': '无法读取插件清单',
        'group.installed': '已安装',
        'group.markets': '市场',
        'group.empty': '还没有插件',
        'group.emptyHint': '插件来自市场：先添加一个市场，再从里面安装。',
        'group.root': '插件目录',
        'row.skills': '个技能',
        'row.agents': '个子代理',
        'row.hooks': '个钩子',
        'row.empty': '没有内容',
        'add.title': '从链接安装',
        'add.hint': '支持 GitHub 仓库、GitHub 子目录，或 .zip 直链。',
        'add.placeholder': 'https://github.com/用户/仓库',
        'add.action': '安装',
        'add.working': '正在安装…',
        'add.cancel': '取消',
        'add.ok': '已安装',
        'add.failed': '安装失败',
        'empty.none': '没有匹配的插件',
        'market.add': '添加市场',
        'market.addPlaceholder': 'https://github.com/用户/仓库（市场地址）',
        'market.adding': '正在添加…',
        'market.refresh': '刷新',
        'market.refreshing': '正在刷新…',
        'market.remove': '移除',
        'market.count': '个插件',
        'market.failed': '无法读取这个市场',
        'market.none': '还没有市场',
        'market.noneHint': '添加一个带 marketplace.json 的 GitHub 仓库，它列出的插件会出现在这里。',
        'market.empty': '这个市场没有可安装的插件',
        'market.step': '第 1 步 · 先添加市场',
        'market.stepHint': '市场就是一个列出插件的 JSON 文件。加一次，里面的插件以后点一下就能装。',
        'installed.step': '插件来自市场',
        'installed.stepHint': '先到「市场」标签里添加一个源，再从那里安装。',
        'action.install': '安装',
        'action.installed': '已安装',
        'tabs.markets': '市场',
        'tabs.installed': '已安装',
        'update.available': '市场有变化',
        'update.detail': '新增 {count} 个插件',
        'update.check': '立即检查',
        'update.checking': '正在检查…',
        'update.dismiss': '知道了',
        'update.auto': '自动检查',
      },
    }

    /**
     * Fallback until the locale service binds, and for any uncovered language.
     *
     * @param {string} key
     * @returns {string}
     */
    let translate = (key) => TEXTS.en[key] ?? key

    const styles = {
      page: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        fontSize: '14px',
        lineHeight: 1.55,
      },
      column: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: '860px',
        margin: '0 auto',
        padding: '36px 32px 56px',
      },

      // Header: title block on the left, controls on the right, one baseline.
      headerRow: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '24px',
      },
      headerText: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 },
      title: { margin: 0, fontSize: '22px', fontWeight: 600, letterSpacing: '-0.015em' },
      subtitle: {
        margin: 0,
        maxWidth: '52ch',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '13px',
      },
      controls: { display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' },

      search: {
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        width: '260px',
        padding: '7px 11px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '999px',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      searchInput: {
        flex: '1 1 auto',
        minWidth: 0,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '13px',
      },
      addButton: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '7px 16px',
        border: 'none',
        borderRadius: '999px',
        background: 'var(--dsw-alias-label-primary)',
        color: 'var(--dsw-alias-bg-base)',
        font: 'inherit',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },

      // The install surface appears only when asked for, so the list keeps the
      // page to itself the rest of the time.
      addPanel: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        margin: '20px 0 0',
        padding: '16px 18px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '12px',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      addHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' },
      addTitle: { fontSize: '13px', fontWeight: 600 },
      addHint: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      addInput: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '9px 12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '9px',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '13px',
      },
      addActions: { display: 'flex', gap: '8px', justifyContent: 'flex-end' },
      primary: (enabled) => ({
        padding: '7px 16px',
        border: 'none',
        borderRadius: '8px',
        background: enabled ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
        color: enabled ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: '13px',
        fontWeight: 600,
        cursor: enabled ? 'pointer' : 'default',
      }),
      secondary: {
        padding: '7px 16px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: '13px',
        cursor: 'pointer',
      },

      notice: (ok) => ({
        display: 'flex',
        alignItems: 'baseline',
        gap: '8px',
        margin: '12px 0 0',
        fontSize: '13px',
        color: ok
          ? 'var(--dsw-alias-state-success-primary)'
          : 'var(--dsw-alias-state-error-primary)',
      }),

      group: { marginTop: '30px' },
      groupHead: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '10px',
        paddingBottom: '10px',
      },
      groupTitle: { fontSize: '15px', fontWeight: 600 },
      groupCount: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
        fontVariantNumeric: 'tabular-nums',
      },
      groupNote: {
        marginLeft: 'auto',
        color: 'var(--dsw-alias-label-secondary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        overflowWrap: 'anywhere',
      },

      // Tabs sit under the header and carry the page's two jobs: the catalog
      // of marketplaces, and what is already installed.
      tabs: {
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        marginTop: '22px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      tab: (active) => ({
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        padding: '8px 12px 9px',
        marginBottom: '-1px',
        border: 'none',
        borderBottom: '2px solid ' + (active ? 'var(--dsw-alias-label-primary)' : 'transparent'),
        background: 'transparent',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: '13px',
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        transition: 'color 120ms ease, border-color 120ms ease',
      }),
      tabCount: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 400,
      },
      dot: {
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-state-warn-primary)',
        flex: '0 0 auto',
      },

      // The update notice sits above the list, so a changed marketplace is
      // visible without opening it.
      updateBar: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginTop: '14px',
        padding: '9px 12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '9px',
        background: 'var(--dsw-alias-bg-layer-1)',
        fontSize: '13px',
      },
      updateText: { color: 'var(--dsw-alias-label-primary)' },
      updateAction: {
        marginLeft: 'auto',
        padding: '4px 12px',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '7px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '12px',
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },

      // Rows, not cards: one grid gives the list its rhythm and keeps each
      // plugin's identity in the icon column.
      list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
      row: {
        display: 'grid',
        gridTemplateColumns: '34px 1fr',
        alignItems: 'start',
        columnGap: '14px',
        padding: '12px 12px',
        margin: '0 -12px',
        borderRadius: '10px',
        transition: 'background-color 120ms ease',
      },
      icon: {
        width: '34px',
        height: '34px',
        borderRadius: '8px',
        objectFit: 'cover',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      iconFallback: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '34px',
        height: '34px',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontWeight: 600,
        fontSize: '14px',
        textTransform: 'uppercase',
      },
      rowText: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 },
      rowName: { fontSize: '14px', fontWeight: 500 },
      rowDesc: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '13px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      rowMetaInline: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
        fontVariantNumeric: 'tabular-nums',
        marginTop: '2px',
      },
      rowMeta: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      },

      empty: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        padding: '52px 0',
        textAlign: 'center',
      },
      emptyTitle: { fontWeight: 600 },
      emptyHint: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' },

      // A marketplace is a section with its own heading row, its own action
      // button, and a list beneath. Sections stack; nothing nests.
      marketBar: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '14px 0 12px',
      },
      marketAdd: {
        display: 'flex',
        gap: '8px',
        margin: '0 0 8px',
      },
      marketInput: {
        flex: '1 1 auto',
        minWidth: 0,
        padding: '8px 12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '13px',
      },
      section: { marginTop: '8px' },
      sectionHead: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '10px',
        paddingBottom: '8px',
      },
      sectionTitle: { fontSize: '14px', fontWeight: 600 },
      sectionCount: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
        fontVariantNumeric: 'tabular-nums',
      },
      sectionActions: { marginLeft: 'auto', display: 'flex', gap: '6px' },
      ghost: {
        padding: '3px 10px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '7px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: '12px',
        cursor: 'pointer',
      },
      marketError: {
        margin: '4px 0 0',
        color: 'var(--dsw-alias-state-warn-primary)',
        fontSize: '12px',
      },
      installChip: (done) => ({
        padding: '3px 12px',
        border: '1px solid ' + (done ? 'transparent' : 'var(--dsw-alias-border-l2)'),
        borderRadius: '7px',
        background: done ? 'transparent' : 'var(--dsw-alias-bg-layer-2)',
        color: done ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '12px',
        fontWeight: 500,
        cursor: done ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }),
    }

    /** A magnifier drawn in one stroke, matching the host's icon weight. */
    function SearchIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
          style: { flex: '0 0 auto', color: 'var(--dsw-alias-label-secondary)' },
        },
        h('circle', { cx: 7, cy: 7, r: 4.5 }),
        h('path', { d: 'M10.4 10.4 14 14' }),
      )
    }

    /**
     * Sidebar glyph: a folder holding a document, matching the bundle icon.
     *
     * @param {{ size: number }} props the shell's icon share.
     */
    function PanelIcon({ size }) {
      return h(
        'svg',
        {
          'data-dsh-panel-entry': PANEL_ID,
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.2 1.5h5.2A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z' }),
        h('path', { d: 'M6.2 8.5h4.1M6.2 10.5h2.7' }),
      )
    }

    /**
     * @param {{ plugin: object, onHover: (hovered: boolean) => void }} props
     */
    function PluginRow({ plugin, onHover, t = translate }) {
      const parts = []
      if (plugin.skills > 0) parts.push(`${String(plugin.skills)} ${t('row.skills')}`)
      if (plugin.agents > 0) parts.push(`${String(plugin.agents)} ${t('row.agents')}`)
      if (plugin.hasHooks) parts.push(t('row.hooks'))

      const glyph = plugin.hasIcon
        ? h('img', {
            src: `/api/plugin-file/icon?name=${encodeURIComponent(plugin.name)}`,
            alt: '',
            style: styles.icon,
            loading: 'lazy',
          })
        : h('span', { style: styles.iconFallback, 'aria-hidden': 'true' }, plugin.name.slice(0, 1))

      const meta = parts.length === 0 ? t('row.empty') : parts.join(' · ')

      return h(
        'li',
        {
          style: styles.row,
          onMouseEnter: () => onHover(true),
          onMouseLeave: () => onHover(false),
        },
        glyph,
        h(
          'div',
          { style: styles.rowText },
          // The name owns the first line; the counts and the description share
          // the lines beneath it, so a long description never fights the
          // numbers for the same row edge.
          h('span', { style: styles.rowName }, plugin.name),
          h(
            'span',
            { style: styles.rowDesc },
            plugin.description ?? plugin.skillsNamed.slice(0, 3).map((name) => `/${name}`).join('  ') ?? '',
          ),
          h('span', { style: styles.rowMetaInline }, meta),
        ),
      )
    }

    /**
     * Read the Host inventory.
     *
     * @returns {Promise<{ root: string, plugins: object[] }>}
     */
    async function readInventory() {
      const response = await fetch('/api/plugin-file/inventory', {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      if (!response.ok) {
        throw new Error(`inventory -> ${String(response.status)} ${response.statusText}`)
      }
      return response.json()
    }

    /**
     * Ask the Host to install one plugin from a link.
     *
     * @param {string} url
     * @returns {Promise<{ ok: boolean, name?: string, skills?: number, agents?: number,
     *   replaced?: boolean, error?: { code: string, message: string } }>}
     */
    async function installPlugin(url) {
      const response = await fetch('/api/plugin-file/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ url }),
      })
      const body = await response.json().catch(() => undefined)
      if (body === undefined) {
        return {
          ok: false,
          error: { code: 'bad-response', message: `${String(response.status)} ${response.statusText}` },
        }
      }
      return body
    }

    /**
     * Read every configured marketplace and its plugins.
     *
     * @param {boolean} refresh
     * @returns {Promise<{ sources: object[] }>}
     */
    async function readMarkets(refresh) {
      const response = await fetch(`/api/plugin-file/markets${refresh ? '?refresh=1' : ''}`, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      if (!response.ok) {
        throw new Error(`markets -> ${String(response.status)} ${response.statusText}`)
      }
      return response.json()
    }

    /**
     * @param {{ action: 'add' | 'remove', url?: string, id?: string }} body
     * @returns {Promise<{ ok: boolean, source?: object, error?: { code: string, message: string } }>}
     */
    async function mutateMarket(body) {
      const response = await fetch('/api/plugin-file/markets/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      return response.json().catch(() => ({
        ok: false,
        error: { code: 'bad-response', message: String(response.status) },
      }))
    }

    /** Bound `t` for this namespace once the locale service is available. */
    let localeService

    /**
     * One marketplace: its heading, its plugin rows, and its own controls.
     *
     * A section rather than a card: the page already has a column, and nesting
     * a box inside it would add a border that carries no meaning.
     *
     * @param {{ source: object, onRemove: (id: string) => void, onInstall: (url: string) => void }} props
     */
    function MarketSection({ source, onRemove, onInstall, t = translate }) {
      const plugins = source.plugins ?? []

      return h(
        'div',
        { style: { marginTop: '14px' } },
        h(
          'div',
          { style: styles.marketBar },
          h('span', { style: styles.name }, source.source.name),
          h('span', { style: styles.groupCount }, `${String(plugins.length)} ${t('market.count')}`),
          h(
            'button',
            {
              type: 'button',
              onClick: () => onRemove(source.source.id),
              style: { ...styles.ghost, marginLeft: 'auto' },
              title: source.source.id,
            },
            t('market.remove'),
          ),
        ),
        source.error === undefined
          ? null
          : h('p', { style: styles.marketError }, `${t('market.failed')}: ${source.error}`),
        plugins.length === 0 && source.error === undefined
          ? h('p', { style: styles.rowMeta }, t('market.empty'))
          : h(
              'ul',
              { style: styles.list },
              plugins.map((entry) =>
                h(
                  'li',
                  { key: entry.name, style: styles.row },
                  h(
                    'span',
                    { style: styles.iconFallback, 'aria-hidden': 'true' },
                    entry.name.slice(0, 1),
                  ),
                  h(
                    'div',
                    { style: styles.rowText },
                    h('span', { style: styles.rowName }, entry.name),
                    h('span', { style: styles.rowDesc }, entry.description ?? entry.installUrl),
                  ),
                  entry.installed
                    ? h('span', { style: styles.installChip(true) }, t('action.installed'))
                    : h(
                        'button',
                        {
                          type: 'button',
                          onClick: () => onInstall(entry.installUrl),
                          style: styles.installChip(false),
                        },
                        t('action.install'),
                      ),
                ),
              ),
            ),
      )
    }

    /**
     * The main-slot page.
     *
     * `t` arrives from the slot runtime because the registration names a locale
     * namespace. The module-level `translate` stays as a fallback for the case
     * where the locale service never mounts; it reads the same keys.
     *
     * @param {{ t?: (key: string) => string }} props
     */
    function PanelPage(props) {
      const t = typeof props?.t === 'function' ? props.t : translate
      const [state, setState] = React.useState({ status: 'loading' })
      const [query, setQuery] = React.useState('')
      const [adding, setAdding] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [installing, setInstalling] = React.useState(false)
      const [outcome, setOutcome] = React.useState(undefined)
      const [markets, setMarkets] = React.useState({ status: 'loading' })
      const [marketDraft, setMarketDraft] = React.useState('')
      const [addingMarket, setAddingMarket] = React.useState(false)
      const [tab, setTab] = React.useState('markets')
      const [pending, setPending] = React.useState(undefined)
      const [, bumpLocale] = React.useState(0)

      /**
       * A fingerprint of everything a marketplace currently lists.
       *
       * Comparing fingerprints is what makes "content changed" cheap: the
       * panel does not need to store plugin lists, only this string.
       */
      const fingerprint = React.useCallback((sources) => {
        return (sources ?? [])
          .map((source) => {
            const names = (source.plugins ?? []).map((entry) => `${entry.name}@${entry.version ?? ''}`)
            return `${source.source.id}:${names.sort().join(',')}`
          })
          .sort()
          .join('|')
      }, [])

      React.useEffect(() => {
        const locale = localeService
        if (locale === undefined) return undefined
        return locale.subscribe(() => bumpLocale((value) => value + 1))
      }, [])

      const load = React.useCallback(() => {
        readInventory().then(
          (value) => setState({ status: 'ready', value }),
          (error) => setState({ status: 'error', error }),
        )
      }, [])

      const loadMarkets = React.useCallback((refresh) => {
        return readMarkets(refresh).then(
          (value) => setMarkets({ status: 'ready', value }),
          (error) => setMarkets({ status: 'error', error }),
        )
      }, [])

      React.useEffect(() => {
        let alive = true
        readInventory().then(
          (value) => {
            if (alive) setState({ status: 'ready', value })
          },
          (error) => {
            if (alive) setState({ status: 'error', error })
          },
        )
        return () => {
          alive = false
        }
      }, [])

      // Marketplaces are read once on mount.
      React.useEffect(() => {
        let alive = true
        readMarkets(false).then(
          (value) => {
            if (alive) setMarkets({ status: 'ready', value })
          },
          (error) => {
            if (alive) setMarkets({ status: 'error', error })
          },
        )
        return () => {
          alive = false
        }
      }, [])

      // Poll the marketplaces while the panel is open, so a change reaches the
      // user without a manual refresh. The interval is deliberately slow and
      // the request is the cached one: a marketplace is remote content, and a
      // panel left open must not turn into a background poller.
      React.useEffect(() => {
        const interval = setInterval(() => {
          readMarkets(true).then(
            (value) => {
              setMarkets((current) => {
                if (current.status === 'ready') {
                  const before = fingerprint(current.value.sources)
                  const after = fingerprint(value.sources)
                  if (before !== after && before !== '') {
                    const known = new Set(
                      current.value.sources.flatMap((source) => (source.plugins ?? []).map((entry) => entry.name)),
                    )
                    const fresh = value.sources
                      .flatMap((source) => source.plugins ?? [])
                      .filter((entry) => !known.has(entry.name))
                    setPending({ fingerprint: after, count: fresh.length })
                  }
                }
                return { status: 'ready', value }
              })
            },
            () => {
              // A failed background refresh keeps the last good list; the user
              // did not ask for this read, so it must not surface an error.
            },
          )
        }, 5 * 60 * 1000)
        return () => clearInterval(interval)
      }, [fingerprint])

      const submit = React.useCallback(
        async (event) => {
          event.preventDefault()
          const url = draft.trim()
          if (url === '' || installing) return

          setInstalling(true)
          setOutcome(undefined)
          try {
            const result = await installPlugin(url)
            setOutcome(result)
            if (result.ok) {
              setDraft('')
              // Close only on success: a failed install should leave the field
              // in place so the link can be corrected and retried.
              setAdding(false)
              load()
            }
          } catch (error) {
            setOutcome({ ok: false, error: { code: 'network', message: String(error) } })
          } finally {
            setInstalling(false)
          }
        },
        [draft, installing, load],
      )

      const submitMarket = React.useCallback(
        async (event) => {
          event.preventDefault()
          const url = marketDraft.trim()
          if (url === '' || addingMarket) return

          setAddingMarket(true)
          setOutcome(undefined)
          try {
            const result = await mutateMarket({ action: 'add', url })
            if (result.ok) {
              setMarketDraft('')
              await loadMarkets(true)
            } else {
              setOutcome({ ok: false, error: result.error })
            }
          } catch (error) {
            setOutcome({ ok: false, error: { code: 'network', message: String(error) } })
          } finally {
            setAddingMarket(false)
          }
        },
        [marketDraft, addingMarket, loadMarkets],
      )

      const removeMarket = React.useCallback(
        async (id) => {
          await mutateMarket({ action: 'remove', id }).catch(() => undefined)
          await loadMarkets(false)
        },
        [loadMarkets],
      )

      const refreshMarkets = React.useCallback(() => {
        setMarkets({ status: 'loading' })
        void loadMarkets(true)
      }, [loadMarkets])

      const installFromMarket = React.useCallback(
        async (url) => {
          setOutcome(undefined)
          try {
            const result = await installPlugin(url)
            setOutcome(result)
            if (result.ok) {
              load()
              await loadMarkets(false)
            }
          } catch (error) {
            setOutcome({ ok: false, error: { code: 'network', message: String(error) } })
          }
        },
        [load, loadMarkets],
      )

      if (state.status === 'loading') {
        return h('div', { style: styles.page }, h('div', { style: styles.column }, h('p', { style: styles.subtitle }, t('page.reading'))))
      }

      if (state.status === 'error') {
        return h(
          'div',
          { style: styles.page },
          h(
            'div',
            { style: styles.column },
            h('p', { style: { ...styles.subtitle, color: 'var(--dsw-alias-state-error-primary)' } },
              `${t('page.error')}: ${String(state.error)}`),
          ),
        )
      }

      const { root, plugins } = state.value
      const needle = query.trim().toLowerCase()
      const shown =
        needle === ''
          ? plugins
          : plugins.filter(
              (plugin) =>
                plugin.name.toLowerCase().includes(needle) ||
                (plugin.description ?? '').toLowerCase().includes(needle) ||
                plugin.skillsNamed.some((name) => name.toLowerCase().includes(needle)),
            )

      return h(
        'div',
        { style: styles.page, 'data-dsh-plugin': 'file-plugins' },
        h(
          'div',
          { style: styles.column },

          h(
            'div',
            { style: styles.headerRow },
            h(
              'div',
              { style: styles.headerText },
              h('h1', { style: styles.title }, t('page.title')),
              h('p', { style: styles.subtitle }, t('page.subtitle')),
            ),
            h(
              'div',
              { style: styles.controls },
              h(
                'label',
                { style: styles.search },
                h(SearchIcon),
                h('input', {
                  type: 'search',
                  value: query,
                  onChange: (event) => setQuery(event.target.value),
                  placeholder: t('page.search'),
                  'aria-label': t('page.search'),
                  style: styles.searchInput,
                }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => {
                    setAdding((open) => !open)
                    setOutcome(undefined)
                  },
                  'aria-expanded': adding,
                  style: styles.addButton,
                },
                t('page.add'),
              ),
            ),
          ),

          adding
            ? h(
                'form',
                { style: styles.addPanel, onSubmit: submit },
                h(
                  'div',
                  { style: styles.addHead },
                  h('span', { style: styles.addTitle }, t('add.title')),
                  h('p', { style: styles.addHint }, t('add.hint')),
                ),
                h('input', {
                  type: 'url',
                  value: draft,
                  onChange: (event) => setDraft(event.target.value),
                  placeholder: t('add.placeholder'),
                  spellCheck: false,
                  autoFocus: true,
                  disabled: installing,
                  'aria-label': t('add.placeholder'),
                  style: styles.addInput,
                }),
                h(
                  'div',
                  { style: styles.addActions },
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => {
                        setAdding(false)
                        setOutcome(undefined)
                      },
                      style: styles.secondary,
                    },
                    t('add.cancel'),
                  ),
                  h(
                    'button',
                    {
                      type: 'submit',
                      disabled: installing || draft.trim() === '',
                      style: styles.primary(!installing && draft.trim() !== ''),
                    },
                    installing ? t('add.working') : t('add.action'),
                  ),
                ),
              )
            : null,

          outcome === undefined
            ? null
            : h(
                'p',
                { style: styles.notice(outcome.ok) },
                outcome.ok
                  ? `${t('add.ok')} ${String(outcome.name)} · ${String(outcome.skills ?? 0)} ${t('row.skills')} · ${String(outcome.agents ?? 0)} ${t('row.agents')}`
                  : `${t('add.failed')}: ${outcome.error?.message ?? ''}`,
              ),

          h(
            'div',
            { style: styles.tabs, role: 'tablist' },
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                'aria-selected': tab === 'markets',
                onClick: () => setTab('markets'),
                style: styles.tab(tab === 'markets'),
              },
              t('tabs.markets'),
              h(
                'span',
                { style: styles.tabCount },
                markets.status === 'ready' ? String(markets.value.sources.length) : '',
              ),
              pending === undefined ? null : h('span', { style: styles.dot, 'aria-hidden': 'true' }),
            ),
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                'aria-selected': tab === 'installed',
                onClick: () => setTab('installed'),
                style: styles.tab(tab === 'installed'),
              },
              t('tabs.installed'),
              h('span', { style: styles.tabCount }, String(plugins.length)),
            ),
          ),

          tab === 'markets' && pending !== undefined
            ? h(
                'div',
                { style: styles.updateBar },
                h(
                  'span',
                  { style: styles.updateText },
                  pending.count > 0
                    ? t('update.detail').replace('{count}', String(pending.count))
                    : t('update.available'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => {
                      setPending(undefined)
                      refreshMarkets()
                    },
                    style: styles.updateAction,
                  },
                  t('update.check'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setPending(undefined),
                    style: { ...styles.updateAction, marginLeft: '0' },
                  },
                  t('update.dismiss'),
                ),
              )
            : null,

          tab === 'markets'
            ? h(
                'section',
                { style: styles.section },

                h(
                  'form',
                  { style: styles.marketAdd, onSubmit: submitMarket },
                  h('input', {
                    type: 'url',
                    value: marketDraft,
                    onChange: (event) => setMarketDraft(event.target.value),
                    placeholder: t('market.addPlaceholder'),
                    spellCheck: false,
                    disabled: addingMarket,
                    'aria-label': t('market.addPlaceholder'),
                    style: styles.marketInput,
                  }),
                  h(
                    'button',
                    {
                      type: 'submit',
                      disabled: addingMarket || marketDraft.trim() === '',
                      style: styles.primary(!addingMarket && marketDraft.trim() !== ''),
                    },
                    addingMarket ? t('market.adding') : t('market.add'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: refreshMarkets,
                      disabled: markets.status === 'loading',
                      style: styles.secondary,
                    },
                    markets.status === 'loading' ? t('market.refreshing') : t('market.refresh'),
                  ),
                ),

                markets.status === 'error'
                  ? h('p', { style: styles.marketError }, `${t('market.failed')}: ${String(markets.error)}`)
                  : markets.status === 'loading'
                    ? h('p', { style: styles.rowMeta }, t('page.reading'))
                    : markets.value.sources.length === 0
                      ? h(
                          'div',
                          { style: { ...styles.empty, paddingTop: '36px' } },
                          h('span', { style: styles.emptyTitle }, t('market.step')),
                          h('span', { style: styles.emptyHint }, t('market.stepHint')),
                        )
                      : markets.value.sources.map((source) =>
                          h(MarketSection, {
                            key: source.source.id,
                            source,
                            t,
                            onRemove: removeMarket,
                            onInstall: installFromMarket,
                          }),
                        ),
              )
            : h(
                'section',
                { style: styles.group },
                h(
                  'div',
                  { style: styles.groupHead },
                  h('span', { style: styles.groupTitle }, t('group.installed')),
                  h('span', { style: styles.groupCount }, String(shown.length)),
                  h('span', { style: styles.groupNote, title: root }, t('group.root')),
                ),
                shown.length === 0
                  ? h(
                      'div',
                      { style: styles.empty },
                      h('span', { style: styles.emptyTitle }, plugins.length === 0 ? t('group.empty') : t('empty.none')),
                      h('span', { style: styles.emptyHint }, plugins.length === 0 ? t('group.emptyHint') : ''),
                    )
                  : h(
                      'ul',
                      { style: styles.list },
                      shown.map((plugin) => h(PluginRow, { key: plugin.name, plugin, t, onHover: () => {} })),
                    ),
              ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // The Client context is restricted: it exposes get/on/provide/effect
        // and no `inject`. Calling `ctx.inject` throws and takes the whole
        // apply with it, which is why the panel kept falling back to English.
        const bind = () => {
          const locale = ctx.get('locale')
          if (locale === undefined) return false
          if (localeService !== locale) {
            localeService = locale
            locale.register('plugin-file', TEXTS)
            translate = locale.bind('plugin-file')
          }
          return true
        }

        // The service may activate after this plugin, and its dictionaries are
        // keyed per namespace, so binding has to be retried when the language
        // or the service itself changes.
        if (!bind()) {
          ctx.on('locale/change', () => {
            bind()
          })
        }

        const slots = ctx.slots
        slots.inject('sidebar.panellist', () =>
          slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: PANEL_ORDER,
              // A thunk is re-read on every projection, so the row label
              // follows a language switch without re-registering.
              label: () => translate('entry.label'),
            },
            PanelIcon,
          ),
        )
        slots.inject('main', () =>
          slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              // The slot runtime injects `t` from this namespace directly into
              // the component, so the page never depends on a module-level
              // binding that a late locale activation could miss.
              locale: 'plugin-file',
            },
            PanelPage,
          ),
        )
      },
    }
  },
})
