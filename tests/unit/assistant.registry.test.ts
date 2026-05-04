import { describe, expect, it, beforeEach, vi } from 'vitest'

// Use vi.resetModules so each test gets a fresh registry — modules are
// import-time singletons and the registry retains state between tests
// otherwise.

describe('assistant tool registry', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('exposes registered extension tools via listAllTools', async () => {
    const { registerExtension, listAllTools } = await import('../../src/assistant/registry')
    registerExtension({
      id: 'fixture',
      name: 'Fixture',
      tools: [
        {
          name: 'echo',
          description: 'Echo back the provided text.',
          input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
      ],
      handlers: {
        echo: async (args: any) => ({ blocks: [{ type: 'text', text: String(args.text) }] }),
      },
    })

    const all = listAllTools()
    expect(all.map(t => t.name)).toContain('echo')
  })

  it('callTool runs the registered handler and propagates errors', async () => {
    const { registerExtension, callTool } = await import('../../src/assistant/registry')
    const { store } = await import('../../src/store/store')
    registerExtension({
      id: 'fixture',
      name: 'Fixture',
      tools: [
        { name: 'good', description: '', input_schema: { type: 'object', properties: {} } },
        { name: 'bad',  description: '', input_schema: { type: 'object', properties: {} } },
      ],
      handlers: {
        good: async () => ({ blocks: [{ type: 'text', text: 'hi' }] }),
        bad:  async () => { throw new Error('boom') },
      },
    })

    const ctx = { store, log: () => {} }
    const ok = await callTool('good', null, ctx)
    expect(ok.isError).toBeFalsy()
    expect((ok.blocks[0] as any).text).toBe('hi')

    const fail = await callTool('bad', null, ctx)
    expect(fail.isError).toBe(true)
    expect((fail.blocks[0] as any).text).toContain('boom')

    const missing = await callTool('nope', null, ctx)
    expect(missing.isError).toBe(true)
    expect((missing.blocks[0] as any).text).toContain('Unknown tool')
  })

  it('core extension registers expected tools', async () => {
    // Importing the index file triggers registerExtension(coreExtension).
    await import('../../src/assistant')
    const { listAllTools } = await import('../../src/assistant/registry')
    const names = listAllTools().map(t => t.name).sort()
    for (const expected of [
      'add_marker',
      'add_region',
      'add_scene_cut',
      'extract_frame',
      'get_video',
      'list_markers',
      'list_regions',
      'list_scenes',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('every tool has an object input_schema', async () => {
    await import('../../src/assistant')
    const { listAllTools } = await import('../../src/assistant/registry')
    for (const tool of listAllTools()) {
      expect(tool.input_schema.type).toBe('object')
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })
})
