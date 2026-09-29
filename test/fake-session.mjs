// A fake session resolver for the request pipeline, so tests never replace the auth import.
// `userId` is a user ID, null (signed out), or a function of the request.
export function fakeSessions({ userId = "owner", password = "correct password" } = {}) {
  return () => ({
    userId: async (request) => typeof userId === "function" ? userId(request) : userId,
    passwordMatches: async (_request, candidate) => candidate === password,
    handle: async () => Response.json({ error: "Not found." }, { status: 404 }),
  });
}

// Calls the request pipeline as the Worker does, with the given pool and sessions.
export function withSessions(handleRequest, sessions = fakeSessions()) {
  return (request, env, ctx, pool) => handleRequest(request, env, ctx, { database: () => pool, sessions });
}
