import { DriveBlueprintItem } from '../types/trading';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

export async function searchDriveFiles(
  accessToken: string,
  searchQuery: string = 'OMEGA'
): Promise<DriveBlueprintItem[]> {
  if (!accessToken) {
    throw new Error('Access token is required to query Google Drive');
  }

  // Construct query: matches title or full text
  // We sanitize searchQuery for single quotes
  const safeQuery = searchQuery.replace(/'/g, "\\'");
  const q = `trashed = false and (name contains '${safeQuery}' or fullText contains '${safeQuery}')`;

  const url = new URL(`${DRIVE_API_BASE}/files`);
  url.searchParams.append('q', q);
  url.searchParams.append('fields', 'files(id, name, mimeType, modifiedTime, size, description, webViewLink)');
  url.searchParams.append('pageSize', '30');
  url.searchParams.append('orderBy', 'modifiedTime desc');

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(
      errData.error?.message || `Google Drive API error: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const files: DriveBlueprintItem[] = (data.files || []).map((file: any) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    size: file.size,
    description: file.description,
    webViewLink: file.webViewLink,
    isBlueprintMatch:
      file.name.toLowerCase().includes('omega') ||
      file.name.toLowerCase().includes('nio') ||
      file.name.toLowerCase().includes('blueprint') ||
      file.name.toLowerCase().includes('sigma') ||
      file.name.toLowerCase().includes('alpha'),
  }));

  return files;
}

export async function fetchFileContent(
  accessToken: string,
  fileId: string,
  mimeType: string
): Promise<string> {
  if (!accessToken) {
    throw new Error('Access token is required');
  }

  // If it's a Google Doc, export as plain text
  if (mimeType === 'application/vnd.google-apps.document') {
    const exportUrl = `${DRIVE_API_BASE}/files/${fileId}/export?mimeType=text/plain`;
    const res = await fetch(exportUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to export Google Doc: ${res.statusText}`);
    }
    return await res.text();
  }

  // Otherwise fetch standard content
  const contentUrl = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;
  const res = await fetch(contentUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch file content: ${res.statusText}`);
  }

  return await res.text();
}
