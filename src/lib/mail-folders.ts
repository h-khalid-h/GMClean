interface MailFolder {
  path: string;
  name: string;
  flags: Set<string>;
  specialUse?: string;
}

export function findTrashFolder(folders: MailFolder[]): string | undefined {
  const selectable = folders.filter(folder => ![...folder.flags].some(flag => flag.toLowerCase() === '\\noselect'));
  // Server metadata is authoritative, regardless of locale or namespace.
  const designated = selectable.find(folder => folder.specialUse?.toLowerCase() === '\\trash'
    || [...folder.flags].some(flag => flag.toLowerCase() === '\\trash'));
  if (designated) return designated.path;

  // Older servers may not advertise SPECIAL-USE. Match exact leaf names,
  // including namespaced folders such as INBOX.Trash and localized Gmail folders.
  const names = new Set(['trash', 'bin', 'deleted items', 'deleted messages', 'deleted', 'papierkorb', 'gelöschte elemente', 'gelöschte objekte', 'gelöschte nachrichten']);
  return selectable.find(folder => names.has(folder.name.trim().toLowerCase()))?.path;
}
