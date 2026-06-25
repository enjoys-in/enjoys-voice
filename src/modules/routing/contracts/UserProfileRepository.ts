export interface UserProfile {
  extension: string;
  dnd?: boolean;
  pstnMobile?: string;
}

export interface UserProfileRepository {
  getByExtension(extension: string): Promise<UserProfile | undefined>;
}
