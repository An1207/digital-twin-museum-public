export type WorkspaceRole = 'writer' | 'curator';

export const resolveWorkspaceRole = (
  roles: string[] | undefined,
  primaryRole?: string | null,
): WorkspaceRole => {
  const roleSet = new Set(roles ?? []);
  const isCurator =
    roleSet.has('paid_curator') ||
    roleSet.has('admin') ||
    primaryRole === 'paid_curator' ||
    primaryRole === 'admin';

  if (isCurator) {
    return 'curator';
  }

  if (roleSet.has('writer') || primaryRole === 'writer') {
    return 'writer';
  }

  return 'curator';
};
