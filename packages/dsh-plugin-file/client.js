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
      if (plugin.skills > 0) meta.push(`${String(plugin.skills)} skill${plugin.skills === 1 ? '' : 's'}`)
      if (plugin.agents > 0) meta.push(`${String(plugin.agents)} agent${plugin.agents === 1 ? '' : 's'}`)
      if (plugin.hasHooks) meta.push('hooks')

      return h(
        'li',
        { style: styles.card },
        h(
          'div',
          { style: styles.cardHead },
          h('span', { style: styles.name }, plugin.name),
          h('span', { style: styles.tag }, meta.length === 0 ? 'no entries' : meta.join(' · ')),
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
      const url = '/api/plugin-file/inventory'
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`${url} -> ${String(response.status)} ${response.statusText}${detail === '' ? '' : `: ${detail.slice(0, 200)}`}`)
      }
      return response.json()
    }

    /**
     * The main-slot page.
     *
     * Reads the Host inventory once per mount. A failed read is shown in
     * place: an empty list would misreport a load failure as "no plugins
     * installed".
     */
    function PanelPage() {
      const [state, setState] = React.useState({ status: 'loading' })

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

      if (state.status === 'loading') {
        return h('div', { style: styles.page }, h('p', { style: styles.subtitle }, 'Reading plugins…'))
      }

      if (state.status === 'error') {
        return h(
          'div',
          { style: styles.page },
          h('p', { style: styles.error }, `Could not read the plugin inventory: ${String(state.error)}`),
        )
      }

      const { root, plugins } = state.value

      return h(
        'div',
        { style: styles.page, 'data-dsh-plugin': 'file-plugins' },
        h(
          'header',
          { style: styles.header },
          h('h1', { style: styles.title }, 'File plugins'),
          h(
            'p',
            { style: styles.subtitle },
            'Drop a directory with a plugin.json here. Skills and commands appear in the / menu; agents appear as presets.',
          ),
        ),
        h('p', { style: styles.path }, root),
        plugins.length === 0
          ? h(
              'div',
              { style: styles.empty },
              h('strong', { style: styles.name }, 'No plugins found'),
              h('span', null, `Create ${root}\\hello\\plugin.json to get started.`),
            )
          : h('ul', { style: styles.list }, plugins.map((plugin) => h(PluginCard, { key: plugin.name, plugin }))),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.slots
        slots.inject('sidebar.panellist', () =>
          slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: PANEL_ORDER,
              label: () => 'File plugins',
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
