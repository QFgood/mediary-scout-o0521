/** Keep readable Unicode titles while avoiding characters rejected by cloud drives.
 * Only apply to storage names; metadata, search keywords and source IDs stay intact. */
export function storageTitleName(title: string): string {
  const replacements: Record<string, string> = {
    ":": "：", "/": "／", "\\": "＼", "*": "＊", "?": "？",
    '"': "＂", "<": "＜", ">": "＞", "|": "｜",
  };
  return title.replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[:/\\*?"<>|]/g, (character) => replacements[character]!)
    .trim().replace(/[. ]+$/g, "") || "Untitled";
}
