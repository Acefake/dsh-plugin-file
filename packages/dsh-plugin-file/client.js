/**
 * Browser half of dsh-plugin-file.
 *
 * Contributes one sidebar panel entry and the page it selects. The page reads
 * the Host inventory over a read-only route the Host half registers. Both slot
 * registrations are wrapped in `ctx.slots.inject` so a shell that does not
 * declare the seat leaves the panel absent instead of failing boot.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-file',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** The sidebar entry id and the `main` slot key; they must match. */
    const PANEL_ID = 'file-plugins'
    const PANEL_ORDER = 30

    /**
     * Text for both baseline locales.
     *
     * Registered through the Client locale service rather than branched in the
     * component: a hardcoded language would ignore the user's choice, and the
     * service already carries the active-locale subscription.
     */
    const TEXTS = {
      en: {
        'entry.label': 'File plugins',
        'page.title': 'File plugins',
        'page.subtitle':
          'Drop a directory with a plugin.json into plugins. Skills and commands appear in the / menu; agents appear as presets.',
        'page.reading': 'Reading plugins…',
        'page.error': 'Could not read the plugin inventory',
        'empty.title': 'No plugins found',
        'empty.hint': 'Create hello/plugin.json inside the directory above to get started.',
        'card.skills': 'skills',
        'card.agents': 'agents',
        'card.hooks': 'hooks',
        'card.empty': 'no entries',
        'install.placeholder': 'Paste a GitHub or .zip link',
        'install.action': 'Install',
        'install.working': 'Installing…',
        'install.ok': 'Installed {name}: {skills} skills, {agents} agents.',
        'install.failed': 'Install failed',
      },
      zh: {
        'entry.label': '文件插件',
        'page.title': '文件插件',
        'page.subtitle':
          '粘贴一个链接就能装：GitHub 仓库、GitHub 子目录，或 .zip 直链。技能和命令会出现在 / 菜单里，子代理会出现在预设里。',
        'page.reading': '正在读取插件…',
        'page.error': '无法读取插件清单',
        'empty.title': '没有发现插件',
        'empty.hint': '把插件链接粘到上面的输入框即可。',
        'card.skills': '个技能',
        'card.agents': '个子代理',
        'card.hooks': '个钩子',
        'card.empty': '没有内容',
        'install.placeholder': '粘贴 GitHub 或 .zip 链接',
        'install.action': '安装',
        'install.working': '正在安装…',
        'install.ok': '已安装 {name}：{skills} 个技能，{agents} 个子代理。',
        'install.failed': '安装失败',
      },
    }

    /**
     * Fallback used until the locale service binds, and for any language the
     * dictionaries do not cover.
     *
     * @param {string} key
     * @returns {string}
     */
    let translate = (key) => TEXTS.en[key] ?? key

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

    const styles = {
      page: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        height: '100%',
        padding: '24px',
        overflowY: 'auto',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        fontSize: '14px',
        lineHeight: '1.5',
      },
      header: { display: 'flex', flexDirection: 'column', gap: '6px' },
      title: { margin: 0, fontSize: '18px', fontWeight: 600 },
      subtitle: { margin: 0, color: 'var(--dsw-alias-label-secondary)' },
      path: {
        margin: 0,
        padding: '8px 10px',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-secondary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        overflowWrap: 'anywhere',
      },
      list: { display: 'flex', flexDirection: 'column', gap: '8px', margin: 0, padding: 0, listStyle: 'none' },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '14px 16px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' },
      name: { fontWeight: 600 },
      desc: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' },
      tags: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      tag: {
        padding: '2px 8px',
        borderRadius: '999px',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
      },
      empty: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '20px',
        border: '1px dashed var(--dsw-alias-border-l2)',
        borderRadius: '10px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      error: { color: 'var(--dsw-alias-state-error-primary)', margin: 0 },
      success: { color: 'var(--dsw-alias-state-success-primary)', margin: 0 },
      form: { display: 'flex', gap: '8px', alignItems: 'stretch' },
      input: {
        flex: '1 1 auto',
        minWidth: 0,
        padding: '8px 12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
      },
      button: {
        flex: '0 0 auto',
        padding: '8px 16px',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-bg-base)',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
      },
    }

    /**
     * @param {string[]} values
     * @returns {Array<object>} one tag per name.
     */
    function tags(values) {
      return values.map((value) => h('span', { key: value, style: styles.tag }, value))
    }

    /**
     * @param {{ plugin: object }} props one discovered plugin.
     */
    function PluginCard({ plugin }) {
      const meta = []
      if (plugin.skills > 0) meta.push(`${String(plugin.skills)} ${translate('card.skills')}`)
      if (plugin.agents > 0) meta.push(`${String(plugin.agents)} ${translate('card.agents')}`)
      if (plugin.hasHooks) meta.push(translate('card.hooks'))

      return h(
        'li',
        { style: styles.card },
        h(
          'div',
          { style: styles.cardHead },
          h('span', { style: styles.name }, plugin.name),
          h('span', { style: styles.tag }, meta.length === 0 ? translate('card.empty') : meta.join(' · ')),
        ),
        plugin.description === undefined ? null : h('p', { style: styles.desc }, plugin.description),
        plugin.skillsNamed.length === 0
          ? null
          : h('div', { style: styles.tags }, tags(plugin.skillsNamed.map((name) => `/${name}`))),
        plugin.agentsNamed.length === 0 ? null : h('div', { style: styles.tags }, tags(plugin.agentsNamed)),
      )
    }

    /**
     * Read the Host inventory over the route the plugin registers.
     *
     * @returns {Promise<{ root: string, plugins: object[] }>}
     */
    async function readInventory() {
      const response = await fetch('/api/plugin-file/inventory', {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(
          `/api/plugin-file/inventory -> ${String(response.status)} ${response.statusText}${detail === '' ? '' : `: ${detail.slice(0, 200)}`}`,
        )
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
        return { ok: false, error: { code: 'bad-response', message: `${String(response.status)} ${response.statusText}` } }
      }
      return body
    }

    /**
     * The main-slot page.
     *
     * Reads the Host inventory once per mount. A failed read is shown in
     * place: an empty list would misreport a load failure as "no plugins".
     */
    function PanelPage() {
      const [state, setState] = React.useState({ status: 'loading' })
      const [draft, setDraft] = React.useState('')
      const [installing, setInstalling] = React.useState(false)
      const [outcome, setOutcome] = React.useState(undefined)
      const [, bumpLocale] = React.useState(0)

      // Re-render on a language switch. The locale service publishes through
      // a snapshot, so the component subscribes instead of reading once.
      React.useEffect(() => {
        const locale = localeService
        if (locale === undefined) return undefined
        return locale.subscribe(() => {
          bumpLocale((value) => value + 1)
        })
      }, [])

      const reload = React.useCallback(() => {
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
              // The Host already refreshed its catalog; re-read so the list
              // reflects what was just installed.
              reload()
            }
          } catch (error) {
            setOutcome({ ok: false, error: { code: 'network', message: String(error) } })
          } finally {
            setInstalling(false)
          }
        },
        [draft, installing, reload],
      )

      const form = h(
        'form',
        { onSubmit: submit, style: styles.form },
        h('input', {
          type: 'url',
          value: draft,
          onChange: (event) => setDraft(event.target.value),
          placeholder: translate('install.placeholder'),
          spellCheck: false,
          disabled: installing,
          'aria-label': translate('install.placeholder'),
          style: styles.input,
        }),
        h(
          'button',
          { type: 'submit', disabled: installing || draft.trim() === '', style: styles.button },
          installing ? translate('install.working') : translate('install.action'),
        ),
      )

      const notice =
        outcome === undefined
          ? null
          : outcome.ok
            ? h(
                'p',
                { style: styles.success },
                translate('install.ok')
                  .replace('{name}', String(outcome.name))
                  .replace('{skills}', String(outcome.skills ?? 0))
                  .replace('{agents}', String(outcome.agents ?? 0)),
              )
            : h(
                'p',
                { style: styles.error },
                `${translate('install.failed')}: ${outcome.error?.message ?? ''}`,
              )

      if (state.status === 'loading') {
        return h('div', { style: styles.page }, h('p', { style: styles.subtitle }, translate('page.reading')))
      }

      if (state.status === 'error') {
        return h(
          'div',
          { style: styles.page },
          h('p', { style: styles.error }, `${translate('page.error')}: ${String(state.error)}`),
        )
      }

      const { root, plugins } = state.value

      return h(
        'div',
        { style: styles.page, 'data-dsh-plugin': 'file-plugins' },
        h(
          'header',
          { style: styles.header },
          h('h1', { style: styles.title }, translate('page.title')),
          h('p', { style: styles.subtitle }, translate('page.subtitle')),
        ),
        form,
        notice,
        h('p', { style: styles.path }, root),
        plugins.length === 0
          ? h(
              'div',
              { style: styles.empty },
              h('strong', { style: styles.name }, translate('empty.title')),
              h('span', null, translate('empty.hint')),
            )
          : h('ul', { style: styles.list }, plugins.map((plugin) => h(PluginCard, { key: plugin.name, plugin }))),
      )
    }

    /** Bound `t` for this namespace once the locale service is available. */
    let localeService

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get('locale')
        if (locale !== undefined) {
          localeService = locale
          locale.register('plugin-file', TEXTS)
          translate = locale.bind('plugin-file')
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
            },
            PanelPage,
          ),
        )
      },
    }
  },
})
