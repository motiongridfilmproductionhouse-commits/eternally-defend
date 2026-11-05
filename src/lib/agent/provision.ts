/** Admin-only provisioning. Never resets or changes an existing account password. */
export async function provisionAgent(
  input: { email: string; password: string },
  deps: {
    isAdmin: () => Promise<boolean>;
    createUser: (email: string, password: string) => Promise<string>;
    enable: (id: string) => Promise<void>;
  },
) {
  if (!(await deps.isAdmin())) throw new Error("Administrator access required.");
  const id = await deps.createUser(input.email, input.password);
  try {
    await deps.enable(id);
    return { id, enabled: true };
  } catch {
    // Auth creation and membership use separate systems. Preserve the new account
    // and report its ID for an explicit retry; never delete or reset another account.
    return { id, enabled: false };
  }
}
