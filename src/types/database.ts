export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          role: "admin" | "manager" | "viewer";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          role?: "admin" | "manager" | "viewer";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          role?: "admin" | "manager" | "viewer";
          updated_at?: string;
        };
        Relationships: [];
      };
      leagues: {
        Row: {
          id: string;
          name: string;
          sport: string;
          season: string;
          status: "active" | "inactive" | "archived";
          owner_id: string;
          start_date: string | null;
          end_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          sport: string;
          season: string;
          status?: "active" | "inactive" | "archived";
          owner_id: string;
          start_date?: string | null;
          end_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          sport?: string;
          season?: string;
          status?: "active" | "inactive" | "archived";
          start_date?: string | null;
          end_date?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          league_id: string;
          division_id: string | null;
          name: string;
          logo_url: string | null;
          contact_email: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          division_id?: string | null;
          name: string;
          logo_url?: string | null;
          contact_email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          league_id?: string;
          division_id?: string | null;
          name?: string;
          logo_url?: string | null;
          contact_email?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      venues: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          address: string | null;
          city: string | null;
          state: string | null;
          capacity: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          address?: string | null;
          city?: string | null;
          state?: string | null;
          capacity?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          address?: string | null;
          city?: string | null;
          state?: string | null;
          capacity?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      divisions: {
        Row: {
          id: string;
          league_id: string;
          name: string;
          team_count: number;
          start_date: string | null;
          end_date: string | null;
          settings: Record<string, unknown>;
          status: "draft" | "active" | "archived";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          name: string;
          team_count?: number;
          start_date?: string | null;
          end_date?: string | null;
          settings?: Record<string, unknown>;
          status?: "draft" | "active" | "archived";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          team_count?: number;
          start_date?: string | null;
          end_date?: string | null;
          settings?: Record<string, unknown>;
          status?: "draft" | "active" | "archived";
          updated_at?: string;
        };
        Relationships: [];
      };
      division_venues: {
        Row: { division_id: string; venue_id: string };
        Insert: { division_id: string; venue_id: string };
        Update: { division_id?: string; venue_id?: string };
        Relationships: [];
      };
      blackout_dates: {
        Row: {
          id: string;
          league_id: string;
          date: string; // YYYY-MM-DD
          label: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          date: string;
          label?: string | null;
          created_at?: string;
        };
        Update: {
          date?: string;
          label?: string | null;
        };
        Relationships: [];
      };
      games: {
        Row: {
          id: string;
          league_id: string;
          home_team_id: string;
          away_team_id: string;
          venue_id: string | null;
          scheduled_at: string;
          status: "scheduled" | "in_progress" | "completed" | "cancelled" | "postponed";
          home_score: number | null;
          away_score: number | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          home_team_id: string;
          away_team_id: string;
          venue_id?: string | null;
          scheduled_at: string;
          status?: "scheduled" | "in_progress" | "completed" | "cancelled" | "postponed";
          home_score?: number | null;
          away_score?: number | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          venue_id?: string | null;
          scheduled_at?: string;
          status?: "scheduled" | "in_progress" | "completed" | "cancelled" | "postponed";
          home_score?: number | null;
          away_score?: number | null;
          notes?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type League = Database["public"]["Tables"]["leagues"]["Row"];
export type BlackoutDate = Database["public"]["Tables"]["blackout_dates"]["Row"];
export type Division = Database["public"]["Tables"]["divisions"]["Row"];
export type Team = Database["public"]["Tables"]["teams"]["Row"];
export type Venue = Database["public"]["Tables"]["venues"]["Row"];
export type Game = Database["public"]["Tables"]["games"]["Row"];
