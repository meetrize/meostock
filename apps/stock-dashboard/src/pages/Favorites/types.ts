export type FavoriteItem = {
  id: string;
  url: string;
  title: string;
  favicon_url: string | null;
  note: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

export const FAVORITES_COLUMNS_KEY = 'favorites.columns';
export const DEFAULT_COLUMNS = 6;
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 20;
