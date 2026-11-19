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
        'group.empty': 'No plugins here yet',
        'group.emptyHint': 'Paste a GitHub or .zip link above to install one.',
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
        'group.empty': '还没有插件',
        'group.emptyHint': '把 GitHub 或 .zip 链接粘到上面的输入框就能装。',
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

      // Rows, not cards: one grid gives the list its rhythm and keeps each
      // plugin's identity in the icon column.
      list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
      row: {
        display: 'grid',
        gridTemplateColumns: '34px 1fr auto',
        alignItems: 'center',
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
    function PluginRow({ plugin, onHover }) {
      const parts = []
      if (plugin.skills > 0) parts.push(`${String(plugin.skills)} ${translate('row.skills')}`)
      if (plugin.agents > 0) parts.push(`${String(plugin.agents)} ${translate('row.agents')}`)
      if (plugin.hasHooks) parts.push(translate('row.hooks'))

      const glyph = plugin.hasIcon
        ? h('img', {
            src: `/api/plugin-file/icon/${encodeURIComponent(plugin.name)}`,
            alt: '',
            style: styles.icon,
            loading: 'lazy',
          })
        : h('span', { style: styles.iconFallback, 'aria-hidden': 'true' }, plugin.name.slice(0, 1))

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
          h('span', { style: styles.rowName }, plugin.name),
          h(
            'span',
            { style: styles.rowDesc },
            plugin.description ?? plugin.skillsNamed.slice(0, 3).map((name) => `/${name}`).join('  ') ?? '',
          ),
        ),
        h('span', { style: styles.rowMeta }, parts.length === 0 ? translate('row.empty') : parts.join(' · ')),
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

    /** Bound `t` for this namespace once the locale service is available. */
    let localeService

    /**
     * The main-slot page.
     */
    function PanelPage() {
      const [state, setState] = React.useState({ status: 'loading' })
      const [query, setQuery] = React.useState('')
      const [adding, setAdding] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [installing, setInstalling] = React.useState(false)
      const [outcome, setOutcome] = React.useState(undefined)
      const [, bumpLocale] = React.useState(0)

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

      if (state.status === 'loading') {
        return h('div', { style: styles.page }, h('div', { style: styles.column }, h('p', { style: styles.subtitle }, translate('page.reading'))))
      }

      if (state.status === 'error') {
        return h(
          'div',
          { style: styles.page },
          h(
            'div',
            { style: styles.column },
            h('p', { style: { ...styles.subtitle, color: 'var(--dsw-alias-state-error-primary)' } },
              `${translate('page.error')}: ${String(state.error)}`),
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
              h('h1', { style: styles.title }, translate('page.title')),
              h('p', { style: styles.subtitle }, translate('page.subtitle')),
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
                  placeholder: translate('page.search'),
                  'aria-label': translate('page.search'),
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
                translate('page.add'),
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
                  h('span', { style: styles.addTitle }, translate('add.title')),
                  h('p', { style: styles.addHint }, translate('add.hint')),
                ),
                h('input', {
                  type: 'url',
                  value: draft,
                  onChange: (event) => setDraft(event.target.value),
                  placeholder: translate('add.placeholder'),
                  spellCheck: false,
                  autoFocus: true,
                  disabled: installing,
                  'aria-label': translate('add.placeholder'),
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
                    translate('add.cancel'),
                  ),
                  h(
                    'button',
                    {
                      type: 'submit',
                      disabled: installing || draft.trim() === '',
                      style: styles.primary(!installing && draft.trim() !== ''),
                    },
                    installing ? translate('add.working') : translate('add.action'),
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
                  ? `${translate('add.ok')} ${String(outcome.name)} · ${String(outcome.skills ?? 0)} ${translate('row.skills')} · ${String(outcome.agents ?? 0)} ${translate('row.agents')}`
                  : `${translate('add.failed')}: ${outcome.error?.message ?? ''}`,
              ),

          h(
            'section',
            { style: styles.group },
            h(
              'div',
              { style: styles.groupHead },
              h('span', { style: styles.groupTitle }, translate('group.installed')),
              h('span', { style: styles.groupCount }, String(shown.length)),
              h('span', { style: styles.groupNote, title: root }, translate('group.root')),
            ),
            shown.length === 0
              ? h(
                  'div',
                  { style: styles.empty },
                  h('span', { style: styles.emptyTitle }, plugins.length === 0 ? translate('group.empty') : translate('empty.none')),
                  h('span', { style: styles.emptyHint }, plugins.length === 0 ? translate('group.emptyHint') : ''),
                )
              : h(
                  'ul',
                  { style: styles.list },
                  shown.map((plugin) => h(PluginRow, { key: plugin.name, plugin, onHover: () => {} })),
                ),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // The locale service is optional and may activate after this plugin.
        // Reading it with `ctx.get` during apply would leave the panel on its
        // English fallback forever, so wait for it explicitly.
        ctx.inject(['locale'], (inner) => {
          const locale = inner.get('locale')
          if (locale === undefined) return
          localeService = locale
          locale.register('plugin-file', TEXTS)
          translate = locale.bind('plugin-file')
        })

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
            },
            PanelPage,
          ),
        )
      },
    }
  },
})
