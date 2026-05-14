export interface CommunityAuthor {
  id:         string;
  full_name:  string | null;
  email:      string | null;
  avatar_url: string | null;
}

export interface CommunityPost {
  id:            string;
  title:         string;
  body:          string;
  category:      string;
  like_count:    number;
  comment_count: number;
  edited_at:     string | null;
  created_at:    string;
  author:        CommunityAuthor | null;
  viewerLiked:   boolean;
}

export interface CommunityComment {
  id:          string;
  body:        string;
  like_count:  number;
  edited_at:   string | null;
  created_at:  string;
  author:      CommunityAuthor | null;
  viewerLiked: boolean;
}
