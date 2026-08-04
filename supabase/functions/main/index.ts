Deno.serve(() => new Response(JSON.stringify({ service: 'muse-edge-runtime', status: 'ready' }), { headers: { 'content-type': 'application/json' } }))
