export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          created_at: string
          division_id: string | null
          event_type: string
          id: string
          league_id: string
          message: string
        }
        Insert: {
          created_at?: string
          division_id?: string | null
          event_type: string
          id?: string
          league_id: string
          message: string
        }
        Update: {
          created_at?: string
          division_id?: string | null
          event_type?: string
          id?: string
          league_id?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      blackout_dates: {
        Row: {
          created_at: string
          date: string
          id: string
          label: string | null
          league_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          label?: string | null
          league_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          label?: string | null
          league_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blackout_dates_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      division_venues: {
        Row: {
          allow_games: boolean
          allow_practices: boolean
          division_id: string
          venue_id: string
        }
        Insert: {
          allow_games?: boolean
          allow_practices?: boolean
          division_id: string
          venue_id: string
        }
        Update: {
          allow_games?: boolean
          allow_practices?: boolean
          division_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "division_venues_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "division_venues_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      divisions: {
        Row: {
          activities_per_week: number | null
          created_at: string
          end_date: string | null
          id: string
          league_id: string
          name: string
          practice_season_end: string | null
          practice_season_start: string | null
          practice_venue_id: string | null
          settings: Json
          start_date: string | null
          status: string
          team_count: number
          updated_at: string
        }
        Insert: {
          activities_per_week?: number | null
          created_at?: string
          end_date?: string | null
          id?: string
          league_id: string
          name: string
          practice_season_end?: string | null
          practice_season_start?: string | null
          practice_venue_id?: string | null
          settings?: Json
          start_date?: string | null
          status?: string
          team_count?: number
          updated_at?: string
        }
        Update: {
          activities_per_week?: number | null
          created_at?: string
          end_date?: string | null
          id?: string
          league_id?: string
          name?: string
          practice_season_end?: string | null
          practice_season_start?: string | null
          practice_venue_id?: string | null
          settings?: Json
          start_date?: string | null
          status?: string
          team_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "divisions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "divisions_practice_venue_id_fkey"
            columns: ["practice_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          away_score: number | null
          away_team_id: string
          created_at: string
          home_score: number | null
          home_team_id: string
          id: string
          league_id: string
          notes: string | null
          scheduled_at: string
          status: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          away_score?: number | null
          away_team_id: string
          created_at?: string
          home_score?: number | null
          home_team_id: string
          id?: string
          league_id: string
          notes?: string | null
          scheduled_at: string
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          away_score?: number | null
          away_team_id?: string
          created_at?: string
          home_score?: number | null
          home_team_id?: string
          id?: string
          league_id?: string
          notes?: string | null
          scheduled_at?: string
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "games_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          name: string
          owner_id: string
          schedule_settings: Json | null
          season: string
          sport: string
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          name: string
          owner_id: string
          schedule_settings?: Json | null
          season: string
          sport: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          name?: string
          owner_id?: string
          schedule_settings?: Json | null
          season?: string
          sport?: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leagues_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      playoffs: {
        Row: {
          created_at: string
          cross_division_enabled: boolean
          cross_division_opponent_id: string | null
          day_windows: Json
          division_id: string
          end_date: string | null
          format: string
          id: string
          league_id: string
          playing_days: string[]
          seeding: Json
          start_date: string | null
          status: string
          updated_at: string
          venue_assignments: Json
        }
        Insert: {
          created_at?: string
          cross_division_enabled?: boolean
          cross_division_opponent_id?: string | null
          day_windows?: Json
          division_id: string
          end_date?: string | null
          format: string
          id?: string
          league_id: string
          playing_days?: string[]
          seeding?: Json
          start_date?: string | null
          status?: string
          updated_at?: string
          venue_assignments?: Json
        }
        Update: {
          created_at?: string
          cross_division_enabled?: boolean
          cross_division_opponent_id?: string | null
          day_windows?: Json
          division_id?: string
          end_date?: string | null
          format?: string
          id?: string
          league_id?: string
          playing_days?: string[]
          seeding?: Json
          start_date?: string | null
          status?: string
          updated_at?: string
          venue_assignments?: Json
        }
        Relationships: [
          {
            foreignKeyName: "playoffs_cross_division_opponent_id_fkey"
            columns: ["cross_division_opponent_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoffs_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoffs_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      practices: {
        Row: {
          created_at: string
          division_id: string
          id: string
          league_id: string
          scheduled_date: string
          start_time: string
          status: string
          team_id: string
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          division_id: string
          id?: string
          league_id: string
          scheduled_date: string
          start_time: string
          status?: string
          team_id: string
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          division_id?: string
          id?: string
          league_id?: string
          scheduled_date?: string
          start_time?: string
          status?: string
          team_id?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "practices_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practices_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practices_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practices_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      team_practice_slots: {
        Row: {
          id: string
          team_id: string
          division_id: string
          day_of_week: "Mo" | "Tu" | "We" | "Th" | "Fr" | "Sa" | "Su"
          start_time: string
          venue_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          team_id: string
          division_id: string
          day_of_week: "Mo" | "Tu" | "We" | "Th" | "Fr" | "Sa" | "Su"
          start_time: string
          venue_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          division_id?: string
          day_of_week?: "Mo" | "Tu" | "We" | "Th" | "Fr" | "Sa" | "Su"
          start_time?: string
          venue_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          contact_email: string | null
          created_at: string
          division_id: string | null
          id: string
          league_id: string
          logo_url: string | null
          name: string
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          division_id?: string | null
          id?: string
          league_id: string
          logo_url?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          division_id?: string | null
          id?: string
          league_id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          capacity: number | null
          city: string | null
          created_at: string
          id: string
          name: string
          owner_id: string
          state: string | null
          updated_at: string
          venue_type: string | null
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          created_at?: string
          id?: string
          name: string
          owner_id: string
          state?: string | null
          updated_at?: string
          venue_type?: string | null
        }
        Update: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          state?: string | null
          updated_at?: string
          venue_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// ── Convenience row-type aliases ─────────────────────────────────────────────
export type Profile     = Database["public"]["Tables"]["profiles"]["Row"];
export type League      = Database["public"]["Tables"]["leagues"]["Row"];
export type BlackoutDate = Database["public"]["Tables"]["blackout_dates"]["Row"];
export type Division    = Database["public"]["Tables"]["divisions"]["Row"];
export type Team        = Database["public"]["Tables"]["teams"]["Row"];
export type Venue       = Database["public"]["Tables"]["venues"]["Row"];
export type Game        = Database["public"]["Tables"]["games"]["Row"];
export type ActivityLog  = Database["public"]["Tables"]["activity_log"]["Row"];
export type Practice     = Database["public"]["Tables"]["practices"]["Row"];
export type Playoff      = Database["public"]["Tables"]["playoffs"]["Row"];
export type PracticeSlot = Database["public"]["Tables"]["team_practice_slots"]["Row"];
