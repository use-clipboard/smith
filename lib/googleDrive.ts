import { google } from 'googleapis';
import { Readable } from 'stream';

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_SITE_URL}/auth/google/callback`
  );
}

export function getAuthUrl(state?: string) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive'],
    state,
  });
}

export async function getDriveClient(accessToken: string, refreshToken: string) {
  const client = getOAuthClient();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return google.drive({ version: 'v3', auth: client });
}

/**
 * Creates a Drive client with a guaranteed fresh access token by calling
 * refreshAccessToken() unconditionally. Callers must persist the returned
 * accessToken back to firm_settings so the next request also starts fresh.
 */
export async function getRefreshedDriveClient(refreshToken: string): Promise<{
  drive: ReturnType<typeof google.drive>;
  accessToken: string;
}> {
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) throw new Error('Token refresh failed — no access_token returned');
  return {
    drive: google.drive({ version: 'v3', auth: client }),
    accessToken: credentials.access_token,
  };
}

/**
 * Upload a file using an already-initialised drive instance (avoids double OAuth client creation).
 */
export async function uploadFileWithDrive(
  drive: ReturnType<typeof google.drive>,
  {
    folderId,
    fileName,
    mimeType,
    buffer,
  }: { folderId: string; fileName: string; mimeType: string; buffer: Buffer }
) {
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: folderId ? [folderId] : undefined,
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id,webViewLink,name',
    supportsAllDrives: true,
  });
  return response.data;
}

/**
 * Create a folder using an already-initialised drive instance.
 */
export async function createFolderWithDrive(
  drive: ReturnType<typeof google.drive>,
  { name, parentFolderId }: { name: string; parentFolderId?: string }
) {
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentFolderId ? [parentFolderId] : undefined,
    },
    fields: 'id,name,webViewLink',
    supportsAllDrives: true,
  });
  return response.data;
}

export async function uploadFileToDrive({
  accessToken,
  refreshToken,
  folderId,
  fileName,
  mimeType,
  buffer,
}: {
  accessToken: string;
  refreshToken: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const drive = await getDriveClient(accessToken, refreshToken);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: folderId ? [folderId] : undefined,
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id,webViewLink,name',
    supportsAllDrives: true,
  });

  return response.data;
}

export async function getFileFromDrive({
  accessToken,
  refreshToken,
  fileId,
}: {
  accessToken: string;
  refreshToken: string;
  fileId: string;
}) {
  const drive = await getDriveClient(accessToken, refreshToken);
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(response.data as ArrayBuffer);
}

export async function createFolder({
  accessToken,
  refreshToken,
  name,
  parentFolderId,
}: {
  accessToken: string;
  refreshToken: string;
  name: string;
  parentFolderId?: string;
}) {
  const drive = await getDriveClient(accessToken, refreshToken);
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentFolderId ? [parentFolderId] : undefined,
    },
    fields: 'id,name,webViewLink',
    supportsAllDrives: true,
  });
  return response.data;
}
