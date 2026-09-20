/**
 * Hand-written to match supabase/migrations/0001_core_schema.sql.
 *
 * Once the project is live, regenerate authoritatively with:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
 *
 * Until then, this file and the migrations must be kept in sync by hand —
 * the migrations remain the source of truth (docs/ARCHITECTURE.md).
 *
 * `Relationships` entries below are what let supabase-js type nested
 * selects like `.select("id, lectures(units(course_id))")` — they mirror
 * the actual foreign keys, not just documentation.
 */

export type CourseRole = "student" | "instructor";
export type MaterialKind = "pptx" | "pdf" | "document" | "link" | "video";
export type IngestionStatus = "pending" | "processing" | "ready" | "failed";

export interface Database {
  public: {
    Tables: {
      courses: {
        Row: {
          id: string;
          code: string;
          title: string;
          term: string;
          auto_enroll: boolean;
          start_date: string | null;
          end_date: string | null;
          meeting_days: string[];
          meeting_start_time: string | null;
          meeting_end_time: string | null;
          timezone: string;
          students_can_see_roster: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          title: string;
          term: string;
          auto_enroll?: boolean;
          start_date?: string | null;
          end_date?: string | null;
          meeting_days?: string[];
          meeting_start_time?: string | null;
          meeting_end_time?: string | null;
          timezone?: string;
          students_can_see_roster?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["courses"]["Insert"]>;
        Relationships: [];
      };
      course_session_notes: {
        Row: {
          id: string;
          course_id: string;
          session_date: string;
          title: string | null;
          agenda: string | null;
          related_lecture_id: string | null;
          related_assessment_id: string | null;
          cancelled: boolean;
          announcement_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          session_date: string;
          title?: string | null;
          agenda?: string | null;
          related_lecture_id?: string | null;
          related_assessment_id?: string | null;
          cancelled?: boolean;
          announcement_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["course_session_notes"]["Insert"]>;
        Relationships: [];
      };
      course_events: {
        Row: {
          id: string;
          course_id: string;
          event_date: string;
          category: "exam" | "project_deadline" | "special_class" | "holiday" | "other";
          title: string;
          details: string | null;
          announcement_id: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          event_date: string;
          category: "exam" | "project_deadline" | "special_class" | "holiday" | "other";
          title: string;
          details?: string | null;
          announcement_id?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["course_events"]["Insert"]>;
        Relationships: [];
      };
      course_members: {
        Row: {
          id: string;
          course_id: string;
          user_id: string;
          role: CourseRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          user_id: string;
          role: CourseRole;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["course_members"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "course_members_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      units: {
        Row: {
          id: string;
          course_id: string;
          title: string;
          position: number;
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          title: string;
          position: number;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["units"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "units_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      lectures: {
        Row: {
          id: string;
          unit_id: string;
          title: string;
          position: number;
          scheduled_for: string | null;
          published_at: string | null;
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          unit_id: string;
          title: string;
          position: number;
          scheduled_for?: string | null;
          published_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["lectures"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "lectures_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
        ];
      };
      materials: {
        Row: {
          id: string;
          lecture_id: string;
          kind: MaterialKind;
          title: string;
          position: number;
          current_version_id: string | null;
          published_at: string | null;
          archived_at: string | null;
          external_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lecture_id: string;
          kind: MaterialKind;
          title: string;
          position: number;
          current_version_id?: string | null;
          published_at?: string | null;
          archived_at?: string | null;
          external_url?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["materials"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "materials_lecture_id_fkey";
            columns: ["lecture_id"];
            isOneToOne: false;
            referencedRelation: "lectures";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "materials_current_version_fk";
            columns: ["current_version_id"];
            isOneToOne: false;
            referencedRelation: "material_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      material_versions: {
        Row: {
          id: string;
          material_id: string;
          version_number: number;
          original_filename: string;
          storage_path: string;
          uploaded_by: string;
          uploaded_at: string;
          ingestion_status: IngestionStatus;
          ingestion_error: string | null;
          slide_count: number | null;
          rendered_pdf_path: string | null;
          rendered_at: string | null;
          extracted_html: string | null;
        };
        Insert: {
          id?: string;
          material_id: string;
          version_number: number;
          original_filename: string;
          storage_path: string;
          uploaded_by: string;
          uploaded_at?: string;
          ingestion_status?: IngestionStatus;
          ingestion_error?: string | null;
          slide_count?: number | null;
          rendered_pdf_path?: string | null;
          rendered_at?: string | null;
          extracted_html?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["material_versions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "material_versions_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
        ];
      };
      slides: {
        Row: {
          id: string;
          material_version_id: string;
          index: number;
          title: string | null;
          text: string;
          speaker_notes: string | null;
        };
        Insert: {
          id?: string;
          material_version_id: string;
          index: number;
          title?: string | null;
          text: string;
          speaker_notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["slides"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "slides_material_version_id_fkey";
            columns: ["material_version_id"];
            isOneToOne: false;
            referencedRelation: "material_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      instructor_allowlist: {
        Row: {
          email: string;
          is_owner: boolean;
          authorized_by: string | null;
          authorized_at: string;
        };
        Insert: {
          email: string;
          is_owner?: boolean;
          authorized_by?: string | null;
          authorized_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["instructor_allowlist"]["Insert"]>;
        Relationships: [];
      };
      enrollment_requests: {
        Row: {
          id: string;
          course_id: string;
          user_id: string;
          status: "pending" | "approved" | "rejected";
          requested_at: string;
          resolved_at: string | null;
          resolved_by: string | null;
        };
        Insert: {
          id?: string;
          course_id: string;
          user_id: string;
          status?: "pending" | "approved" | "rejected";
          requested_at?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["enrollment_requests"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "enrollment_requests_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      question_banks: {
        Row: { id: string; course_id: string; title: string; version: number; created_at: string };
        Insert: { id?: string; course_id: string; title: string; version?: number; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["question_banks"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "question_banks_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      questions: {
        Row: {
          id: string;
          bank_id: string;
          source_lecture_id: string | null;
          learning_objective_id: string | null;
          topic: string;
          difficulty: string;
          question_type: string;
          prompt: string;
          active: boolean;
          visibility: "practice" | "hidden";
          source_position: number | null;
          answer_guide: string | null;
          explanation: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          bank_id: string;
          source_lecture_id?: string | null;
          learning_objective_id?: string | null;
          topic: string;
          difficulty?: string;
          question_type?: string;
          prompt: string;
          active?: boolean;
          visibility?: "practice" | "hidden";
          source_position?: number | null;
          answer_guide?: string | null;
          explanation?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["questions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "questions_bank_id_fkey";
            columns: ["bank_id"];
            isOneToOne: false;
            referencedRelation: "question_banks";
            referencedColumns: ["id"];
          },
        ];
      };
      question_options: {
        Row: { id: string; question_id: string; position: number; text: string; is_correct: boolean };
        Insert: {
          id?: string;
          question_id: string;
          position: number;
          text: string;
          is_correct?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["question_options"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "question_options_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      assessments: {
        Row: {
          id: string;
          course_id: string;
          bank_id: string;
          title: string;
          instructions: string;
          question_count: number;
          published_at: string | null;
          locked: boolean;
          kind: "mock_test" | "class_test" | "project";
          points_possible: number | null;
          contributes_to_grade: boolean;
          selection_mode: "random" | "fixed";
          question_order_mode: "fixed" | "shuffled";
          option_order_mode: "fixed" | "shuffled";
          is_diagnostic: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          bank_id: string;
          title: string;
          instructions?: string;
          question_count: number;
          published_at?: string | null;
          locked?: boolean;
          kind?: "mock_test" | "class_test" | "project";
          points_possible?: number | null;
          contributes_to_grade?: boolean;
          selection_mode?: "random" | "fixed";
          question_order_mode?: "fixed" | "shuffled";
          option_order_mode?: "fixed" | "shuffled";
          is_diagnostic?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["assessments"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "assessments_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assessments_bank_id_fkey";
            columns: ["bank_id"];
            isOneToOne: false;
            referencedRelation: "question_banks";
            referencedColumns: ["id"];
          },
        ];
      };
      assessment_rules: {
        Row: {
          id: string;
          assessment_id: string;
          position: number;
          source_lecture_id: string | null;
          topic: string | null;
          difficulty: string | null;
          count: number;
          fixed_question_id: string | null;
          question_type: string | null;
          visibility_filter: string | null;
        };
        Insert: {
          id?: string;
          assessment_id: string;
          position: number;
          source_lecture_id?: string | null;
          topic?: string | null;
          difficulty?: string | null;
          count: number;
          fixed_question_id?: string | null;
          question_type?: string | null;
          visibility_filter?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["assessment_rules"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "assessment_rules_assessment_id_fkey";
            columns: ["assessment_id"];
            isOneToOne: false;
            referencedRelation: "assessments";
            referencedColumns: ["id"];
          },
        ];
      };
      attempts: {
        Row: {
          id: string;
          assessment_id: string;
          user_id: string;
          bank_version: number;
          started_at: string;
          submitted_at: string | null;
          score: number | null;
          max_score: number | null;
          pending_grading_count: number;
        };
        Insert: {
          id?: string;
          assessment_id: string;
          user_id: string;
          bank_version: number;
          started_at?: string;
          submitted_at?: string | null;
          score?: number | null;
          max_score?: number | null;
          pending_grading_count?: number;
        };
        Update: Partial<Database["public"]["Tables"]["attempts"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "attempts_assessment_id_fkey";
            columns: ["assessment_id"];
            isOneToOne: false;
            referencedRelation: "assessments";
            referencedColumns: ["id"];
          },
        ];
      };
      attempt_questions: {
        Row: {
          id: string;
          attempt_id: string;
          question_id: string;
          position: number;
          option_order: unknown;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          question_id: string;
          position: number;
          option_order: unknown;
        };
        Update: Partial<Database["public"]["Tables"]["attempt_questions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "attempt_questions_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "attempts";
            referencedColumns: ["id"];
          },
        ];
      };
      responses: {
        Row: {
          id: string;
          attempt_id: string;
          question_id: string;
          selected_option_id: string | null;
          text_response: string | null;
          is_correct_manual: boolean | null;
          graded_by: string | null;
          graded_at: string | null;
          grading_note: string | null;
          answered_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          question_id: string;
          selected_option_id?: string | null;
          text_response?: string | null;
          is_correct_manual?: boolean | null;
          graded_by?: string | null;
          graded_at?: string | null;
          grading_note?: string | null;
          answered_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["responses"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "responses_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "attempts";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_objectives: {
        Row: {
          id: string;
          course_id: string;
          title: string;
          description: string;
          lecture_id: string | null;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          title: string;
          description?: string;
          lecture_id?: string | null;
          position: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["learning_objectives"]["Insert"]>;
        Relationships: [];
      };
      material_chunks: {
        Row: {
          id: string;
          course_id: string;
          lecture_id: string;
          material_id: string;
          material_version_id: string;
          slide_id: string;
          learning_objective_id: string | null;
          position: number;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          lecture_id: string;
          material_id: string;
          material_version_id: string;
          slide_id: string;
          learning_objective_id?: string | null;
          position: number;
          content: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["material_chunks"]["Insert"]>;
        Relationships: [];
      };
      tutor_sessions: {
        Row: {
          id: string;
          user_id: string;
          course_id: string;
          learning_objective_id: string | null;
          entry_source: "direct" | "performance" | "assessment_review" | "slide" | "question_bank_practice";
          source_attempt_id: string | null;
          source_lecture_id: string | null;
          source_slide_id: string | null;
          source_practice_attempt_id: string | null;
          created_at: string;
          last_message_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          course_id: string;
          learning_objective_id?: string | null;
          entry_source?: "direct" | "performance" | "assessment_review" | "slide" | "question_bank_practice";
          source_attempt_id?: string | null;
          source_lecture_id?: string | null;
          source_slide_id?: string | null;
          source_practice_attempt_id?: string | null;
          created_at?: string;
          last_message_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tutor_sessions"]["Insert"]>;
        Relationships: [];
      };
      tutor_messages: {
        Row: {
          id: string;
          session_id: string;
          role: "user" | "assistant";
          content: string;
          teaching_move: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          role: "user" | "assistant";
          content: string;
          teaching_move?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tutor_messages"]["Insert"]>;
        Relationships: [];
      };
      practice_attempts: {
        Row: {
          id: string;
          user_id: string;
          course_id: string;
          learning_objective_id: string;
          tutor_session_id: string | null;
          source_type: "question_bank" | "ai_generated";
          question_id: string | null;
          selected_option_id: string | null;
          prompt: string;
          expected_answer_kind: "numeric" | "short_text" | "explanation" | "multiple_choice";
          canonical_answer: string | null;
          student_answer: string | null;
          correct: boolean | null;
          evaluation_reason: string | null;
          created_at: string;
          answered_at: string | null;
        };
        Insert: never; // insert-only via create_practice_attempt() / submit_question_bank_practice_answer() RPCs
        Update: never;
        Relationships: [];
      };
      profiles: {
        Row: {
          user_id: string;
          full_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      tutor_preferences: {
        Row: {
          user_id: string;
          explanation_style: "example_first" | "explain_first" | "guided_discovery" | null;
          correction_style: "hint_first" | "step_by_step" | "tell_and_explain" | null;
          detail_level: "short" | "balanced" | "detailed" | null;
          practice_pacing: "one_at_a_time" | "more_explanation" | "move_quickly" | null;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          explanation_style?: "example_first" | "explain_first" | "guided_discovery" | null;
          correction_style?: "hint_first" | "step_by_step" | "tell_and_explain" | null;
          detail_level?: "short" | "balanced" | "detailed" | null;
          practice_pacing?: "one_at_a_time" | "more_explanation" | "move_quickly" | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tutor_preferences"]["Insert"]>;
        Relationships: [];
      };
      announcements: {
        Row: {
          id: string;
          course_id: string;
          title: string;
          body: string;
          pinned: boolean;
          published_at: string | null;
          expires_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          title: string;
          body: string;
          pinned?: boolean;
          published_at?: string | null;
          expires_at?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["announcements"]["Insert"]>;
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          assessment_id: string;
          course_id: string;
          description: string;
          group_mode: "instructor_assigned" | "self_enrollment";
          groups_locked: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          assessment_id: string;
          course_id: string;
          description?: string;
          group_mode?: "instructor_assigned" | "self_enrollment";
          groups_locked?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
        Relationships: [];
      };
      project_groups: {
        Row: { id: string; project_id: string; name: string; capacity: number | null; created_at: string };
        Insert: { id?: string; project_id: string; name: string; capacity?: number | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["project_groups"]["Insert"]>;
        Relationships: [];
      };
      project_group_grades: {
        Row: {
          id: string;
          project_id: string;
          group_id: string;
          score: number;
          max_score: number;
          feedback: string | null;
          graded_by: string;
          graded_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          group_id: string;
          score: number;
          max_score: number;
          feedback?: string | null;
          graded_by: string;
          graded_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["project_group_grades"]["Insert"]>;
        Relationships: [];
      };
      project_group_members: {
        Row: {
          id: string;
          group_id: string;
          user_id: string | null;
          imported_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          user_id?: string | null;
          imported_name?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["project_group_members"]["Insert"]>;
        Relationships: [];
      };
      project_deliverables: {
        Row: {
          id: string;
          project_id: string;
          title: string;
          description: string;
          due_at: string | null;
          position: number;
          submission_enabled: boolean;
          allowed_type: string | null;
          published: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          title: string;
          description?: string;
          due_at?: string | null;
          position: number;
          submission_enabled?: boolean;
          allowed_type?: string | null;
          published?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["project_deliverables"]["Insert"]>;
        Relationships: [];
      };
      project_submissions: {
        Row: {
          id: string;
          deliverable_id: string;
          group_id: string;
          submitted_by_user_id: string;
          storage_path: string;
          note: string | null;
          submitted_at: string;
          superseded_at: string | null;
        };
        // Client-facing writes are insert-only via
        // submit_project_deliverable() RPC — this Insert type exists
        // for the service-role/test-fixture path only (RLS has no
        // client insert policy on this table either way).
        Insert: {
          id?: string;
          deliverable_id: string;
          group_id: string;
          submitted_by_user_id: string;
          storage_path: string;
          note?: string | null;
          submitted_at?: string;
          superseded_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["project_submissions"]["Insert"]>;
        Relationships: [];
      };
      student_misconceptions: {
        Row: {
          user_id: string;
          course_id: string;
          learning_objective_id: string;
          description: string;
          resolved: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: never; // insert-only via record_misconception() RPC
        Update: never;
        Relationships: [];
      };
      ai_usage_config: {
        Row: {
          id: boolean;
          student_daily_limit: number;
          course_daily_limit: number;
          global_daily_limit: number;
          cooldown_seconds: number;
          ai_paused: boolean;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      course_ai_settings: {
        Row: { course_id: string; ai_paused: boolean; updated_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      ai_generation_events: {
        Row: {
          id: string;
          user_id: string;
          course_id: string | null;
          role: "student" | "instructor" | "owner";
          entry_context:
            | "tutor_direct"
            | "tutor_performance"
            | "tutor_assessment_review"
            | "tutor_slide"
            | "tutor_question_explain"
            | "practice_evaluation";
          model: string | null;
          input_tokens: number | null;
          output_tokens: number | null;
          status: "reserved" | "success" | "failed";
          created_at: string;
          completed_at: string | null;
        };
        Insert: never; // insert-only via reserve_ai_generation() RPC
        Update: never;
        Relationships: [];
      };
      learning_objective_intelligence: {
        Row: {
          id: string;
          learning_objective_id: string;
          course_id: string;
          canonical_explanation: string | null;
          key_facts: unknown;
          common_misconceptions: unknown;
          diagnostic_cues: unknown;
          analogies: unknown;
          teaching_progression: unknown;
          practice_generation_guidance: string | null;
          source_refs: unknown;
          source_hash: string | null;
          prompt_version: string;
          model: string | null;
          status: "ready" | "stale" | "missing" | "generating" | "failed";
          error: string | null;
          generated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never; // written only by the service-role compiler script
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      search_course_material: {
        Args: {
          p_course_id: string;
          p_query: string;
          p_learning_objective_id?: string | null;
          p_limit?: number;
        };
        Returns: {
          chunk_id: string;
          lecture_title: string;
          material_title: string;
          slide_index: number;
          slide_title: string | null;
          content: string;
          rank: number;
        }[];
      };
      get_student_objective_evidence: {
        Args: { p_course_id: string };
        Returns: {
          learning_objective_id: string;
          title: string;
          position: number;
          correct: number;
          attempted: number;
        }[];
      };
      get_student_practice_evidence: {
        Args: { p_course_id: string };
        Returns: {
          learning_objective_id: string;
          title: string;
          position: number;
          correct: number;
          attempted: number;
        }[];
      };
      create_practice_attempt: {
        Args: {
          p_course_id: string;
          p_learning_objective_id: string;
          p_tutor_session_id: string;
          p_prompt: string;
          p_expected_answer_kind: string;
          p_canonical_answer: string;
        };
        Returns: { id: string; prompt: string; expectedAnswerKind: string };
      };
      submit_practice_answer: {
        Args: { p_practice_attempt_id: string; p_student_answer: string };
        Returns:
          | { status: "pending_evaluation"; rubricNotes: string; prompt: string; courseId: string }
          | { status: "graded"; correct: boolean; evaluationReason: string };
      };
      record_practice_evaluation: {
        Args: { p_practice_attempt_id: string; p_correct: boolean; p_evaluation_reason: string };
        Returns: { status: "graded"; correct: boolean; evaluationReason: string };
      };
      get_attempt_mistakes: {
        Args: { p_attempt_id: string };
        Returns: {
          question_prompt: string;
          student_answer_text: string;
          correct_answer_text: string;
          learning_objective_id: string | null;
          learning_objective_title: string | null;
        }[];
      };
      record_misconception: {
        Args: {
          p_course_id: string;
          p_learning_objective_id: string;
          p_description: string;
          p_resolved: boolean;
        };
        Returns: undefined;
      };
      reserve_ai_generation: {
        Args: { p_course_id: string; p_entry_context: string };
        Returns: { allowed: true; eventId: string } | { allowed: false; reason: string };
      };
      complete_ai_generation: {
        Args: {
          p_event_id: string;
          p_status: "success" | "failed";
          p_model?: string | null;
          p_input_tokens?: number | null;
          p_output_tokens?: number | null;
        };
        Returns: undefined;
      };
      set_course_ai_paused: {
        Args: { p_course_id: string; p_paused: boolean };
        Returns: undefined;
      };
      set_global_ai_paused: {
        Args: { p_paused: boolean };
        Returns: undefined;
      };
      get_course_ai_usage_today: {
        Args: { p_course_id: string };
        Returns: {
          studentGenerationsToday: number;
          inputTokensToday: number;
          outputTokensToday: number;
          failedToday: number;
        };
      };
      get_practice_attempt_for_tutor: {
        Args: { p_practice_attempt_id: string };
        Returns: {
          courseId: string;
          learningObjectiveId: string;
          learningObjectiveTitle: string | null;
          prompt: string;
          studentAnswer: string | null;
          correctAnswer: string | null;
          wasCorrect: boolean | null;
        };
      };
      upsert_my_full_name: {
        Args: { p_full_name: string };
        Returns: undefined;
      };
      upsert_my_tutor_preferences: {
        Args: {
          p_explanation_style: string | null;
          p_correction_style: string | null;
          p_detail_level: string | null;
          p_practice_pacing: string | null;
        };
        Returns: undefined;
      };
      list_project_groups: {
        Args: { p_project_id: string };
        Returns: {
          group_id: string;
          group_name: string;
          member_user_id: string;
          member_full_name: string;
          is_me: boolean;
        }[];
      };
      get_my_project_group: {
        Args: { p_project_id: string };
        Returns: {
          group: null;
        } | {
          groupId: string;
          deliverables: {
            deliverableId: string;
            title: string;
            description: string;
            dueAt: string | null;
            position: number;
            submissionEnabled: boolean;
            allowedType: string | null;
            submitted: boolean;
            submittedAt: string | null;
            submittedByUserId: string | null;
            submittedByName: string;
            note: string | null;
          }[];
        };
      };
      submit_project_deliverable: {
        Args: { p_deliverable_id: string; p_storage_path: string; p_note?: string | null };
        Returns: { submissionId: string; groupId: string };
      };
      set_project_group_mode: {
        Args: { p_project_id: string; p_mode: "instructor_assigned" | "self_enrollment" };
        Returns: undefined;
      };
      set_project_groups_locked: {
        Args: { p_project_id: string; p_locked: boolean };
        Returns: undefined;
      };
      create_project_group: {
        Args: { p_project_id: string; p_name: string; p_capacity?: number | null };
        Returns: string;
      };
      update_project_group: {
        Args: { p_group_id: string; p_name: string; p_capacity: number | null };
        Returns: undefined;
      };
      delete_project_group: {
        Args: { p_group_id: string };
        Returns: undefined;
      };
      assign_student_to_group: {
        Args: { p_group_id: string; p_user_id: string };
        Returns: undefined;
      };
      remove_student_from_group: {
        Args: { p_group_id: string; p_user_id: string };
        Returns: undefined;
      };
      join_project_group: {
        Args: { p_group_id: string };
        Returns: undefined;
      };
      leave_project_group: {
        Args: { p_group_id: string };
        Returns: undefined;
      };
      create_project_deliverable: {
        Args: {
          p_project_id: string;
          p_title: string;
          p_description: string;
          p_due_at: string | null;
          p_submission_enabled: boolean;
          p_allowed_type: string | null;
          p_published: boolean;
        };
        Returns: string;
      };
      update_project_deliverable: {
        Args: {
          p_deliverable_id: string;
          p_title: string;
          p_description: string;
          p_due_at: string | null;
          p_submission_enabled: boolean;
          p_allowed_type: string | null;
          p_published: boolean;
        };
        Returns: undefined;
      };
      delete_project_deliverable: {
        Args: { p_deliverable_id: string };
        Returns: undefined;
      };
      set_project_group_grade: {
        Args: {
          p_project_id: string;
          p_group_id: string;
          p_score: number;
          p_max_score: number;
          p_feedback: string | null;
        };
        Returns: undefined;
      };
      get_project_instructor_overview: {
        Args: { p_project_id: string };
        Returns: {
          groupMode: "instructor_assigned" | "self_enrollment";
          groupsLocked: boolean;
          groups: {
            groupId: string;
            name: string;
            capacity: number | null;
            members: { userId: string; fullName: string }[];
            grade: { score: number; maxScore: number; feedback: string | null } | null;
          }[];
          unassignedStudents: { userId: string; fullName: string }[];
        };
      };
      list_practice_questions: {
        Args: { p_course_id: string; p_lecture_id?: string | null };
        Returns: {
          question_id: string;
          prompt: string;
          topic: string;
          source_lecture_id: string | null;
          learning_objective_id: string | null;
        }[];
      };
      get_practice_question: {
        Args: { p_question_id: string };
        Returns: {
          questionId: string;
          prompt: string;
          learningObjectiveId: string | null;
          options: { optionId: string; text: string }[];
        };
      };
      submit_question_bank_practice_answer: {
        Args: { p_question_id: string; p_selected_option_id: string };
        Returns: { practiceAttemptId: string; correct: boolean };
      };
      list_practice_attempts: {
        Args: { p_tutor_session_id: string };
        Returns: {
          id: string;
          learning_objective_id: string;
          prompt: string;
          expected_answer_kind: string;
          student_answer: string | null;
          correct: boolean | null;
          evaluation_reason: string | null;
          created_at: string;
          answered_at: string | null;
        }[];
      };
      current_user_is_owner: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      get_student_objective_evidence_for_instructor: {
        Args: { p_course_id: string; p_user_id: string };
        Returns: { learning_objective_id: string; title: string; position: number; correct: number; attempted: number }[];
      };
      get_student_practice_evidence_for_instructor: {
        Args: { p_course_id: string; p_user_id: string };
        Returns: { learning_objective_id: string; title: string; position: number; correct: number; attempted: number }[];
      };
      list_course_members_directory: {
        Args: { p_course_id: string };
        Returns: { user_id: string; full_name: string; is_me: boolean }[];
      };
      set_course_schedule: {
        Args: {
          p_course_id: string;
          p_start_date: string | null;
          p_end_date: string | null;
          p_meeting_days: string[];
          p_meeting_start_time: string | null;
          p_meeting_end_time: string | null;
          p_timezone: string;
        };
        Returns: undefined;
      };
      set_course_roster_visibility: {
        Args: { p_course_id: string; p_visible: boolean };
        Returns: undefined;
      };
      get_course_calendar: {
        Args: { p_course_id: string; p_from: string; p_to: string };
        Returns: {
          startDate: string | null;
          endDate: string | null;
          meetingDays: string[];
          meetingStartTime: string | null;
          meetingEndTime: string | null;
          timezone: string;
          sessions: {
            date: string;
            dayName: string;
            note: {
              id: string;
              title: string | null;
              agenda: string | null;
              cancelled: boolean;
              relatedLectureId: string | null;
              relatedAssessmentId: string | null;
              announcementId: string | null;
            } | null;
          }[];
          events: {
            id: string;
            date: string;
            category: "exam" | "project_deadline" | "special_class" | "holiday" | "other";
            title: string;
            details: string | null;
            announcementId: string | null;
          }[];
        };
      };
      upsert_session_note: {
        Args: {
          p_course_id: string;
          p_session_date: string;
          p_title: string | null;
          p_agenda: string | null;
          p_related_lecture_id: string | null;
          p_related_assessment_id: string | null;
          p_cancelled: boolean;
          p_announcement_id: string | null;
        };
        Returns: string;
      };
      create_course_event: {
        Args: {
          p_course_id: string;
          p_event_date: string;
          p_category: "exam" | "project_deadline" | "special_class" | "holiday" | "other";
          p_title: string;
          p_details: string | null;
          p_announcement_id: string | null;
        };
        Returns: string;
      };
      delete_course_event: {
        Args: { p_event_id: string };
        Returns: undefined;
      };
      rename_unit: { Args: { p_unit_id: string; p_title: string }; Returns: undefined };
      rename_lecture: { Args: { p_lecture_id: string; p_title: string }; Returns: undefined };
      rename_material: { Args: { p_material_id: string; p_title: string }; Returns: undefined };
      reorder_unit: { Args: { p_unit_id: string; p_direction: "up" | "down" }; Returns: undefined };
      reorder_lecture: { Args: { p_lecture_id: string; p_direction: "up" | "down" }; Returns: undefined };
      reorder_material: { Args: { p_material_id: string; p_direction: "up" | "down" }; Returns: undefined };
      set_unit_archived: { Args: { p_unit_id: string; p_archived: boolean }; Returns: undefined };
      set_lecture_archived: { Args: { p_lecture_id: string; p_archived: boolean }; Returns: undefined };
      set_material_archived: { Args: { p_material_id: string; p_archived: boolean }; Returns: undefined };
      delete_unit_if_unused: { Args: { p_unit_id: string }; Returns: undefined };
      delete_lecture_if_unused: { Args: { p_lecture_id: string }; Returns: undefined };
      delete_material_if_unused: { Args: { p_material_id: string }; Returns: undefined };
      get_course_intelligence_status: {
        Args: { p_course_id: string };
        Returns: {
          learning_objective_id: string;
          title: string;
          position: number;
          status: "ready" | "stale" | "missing" | "generating" | "failed";
          generated_at: string | null;
          model: string | null;
          error: string | null;
          chunk_count: number;
        }[];
      };
      start_intelligence_regeneration: {
        Args: { p_learning_objective_id: string };
        Returns: { title: string; description: string; sourceMaterial: string };
      };
      write_learning_objective_intelligence: {
        Args: {
          p_learning_objective_id: string;
          p_canonical_explanation: string;
          p_key_facts: string[];
          p_common_misconceptions: { misconception: string; diagnosticCue: string }[];
          p_analogies: string[];
          p_teaching_progression: string[];
          p_practice_generation_guidance: string;
          p_source_hash: string;
          p_model: string;
        };
        Returns: undefined;
      };
      fail_learning_objective_intelligence: {
        Args: { p_learning_objective_id: string; p_error: string };
        Returns: undefined;
      };
      enroll_in_course: {
        Args: { p_course_id: string };
        Returns: { status: "enrolled" | "pending"; already: boolean };
      };
      approve_enrollment_request: {
        Args: { p_request_id: string };
        Returns: undefined;
      };
      reject_enrollment_request: {
        Args: { p_request_id: string };
        Returns: undefined;
      };
      remove_course_member: {
        Args: { p_course_id: string; p_user_id: string };
        Returns: undefined;
      };
      list_course_roster: {
        Args: { p_course_id: string };
        Returns: { user_id: string; email: string; full_name: string | null; enrolled_at: string }[];
      };
      list_pending_requests: {
        Args: { p_course_id: string };
        Returns: { request_id: string; user_id: string; email: string; full_name: string | null; requested_at: string }[];
      };
      add_instructor_email: {
        Args: { p_email: string };
        Returns: undefined;
      };
      create_course: {
        Args: { p_code: string; p_title: string; p_term: string };
        Returns: string;
      };
      get_course_instructors: {
        Args: Record<string, never>;
        Returns: { course_id: string; instructor_name: string | null }[];
      };
      remove_instructor_email: {
        Args: { p_email: string };
        Returns: undefined;
      };
      list_instructor_status: {
        Args: Record<string, never>;
        Returns: {
          email: string;
          is_owner: boolean;
          authorized_at: string;
          user_registered: boolean;
          email_verified: boolean;
          is_active_instructor: boolean;
        }[];
      };
      start_attempt: {
        Args: { p_assessment_id: string };
        Returns: string;
      };
      create_assessment: {
        Args: {
          p_course_id: string;
          p_bank_id: string;
          p_title: string;
          p_instructions: string;
          p_kind: "mock_test" | "class_test" | "project";
          p_points_possible: number | null;
          p_selection_mode: "random" | "fixed";
          p_question_order_mode: "fixed" | "shuffled";
          p_option_order_mode: "fixed" | "shuffled";
          p_rules: {
            position: number;
            sourceLectureId?: string | null;
            topic?: string | null;
            difficulty?: string | null;
            count?: number;
            fixedQuestionId?: string | null;
            questionType?: "single_choice" | "written" | null;
            visibilityFilter?: "practice" | "hidden" | null;
          }[];
          p_is_diagnostic?: boolean;
        };
        Returns: string;
      };
      save_response: {
        Args: {
          p_attempt_id: string;
          p_question_id: string;
          p_selected_option_id: string | null;
          p_text_response?: string | null;
        };
        Returns: undefined;
      };
      submit_attempt: {
        Args: { p_attempt_id: string };
        Returns: { score: number; maxScore: number; pendingGradingCount: number; alreadySubmitted: boolean };
      };
      grade_written_response: {
        Args: { p_attempt_id: string; p_question_id: string; p_is_correct: boolean; p_grading_note?: string | null };
        Returns: { score: number; maxScore: number; pendingGradingCount: number };
      };
      list_assessment_attempts: {
        Args: { p_assessment_id: string };
        Returns: {
          attempt_id: string;
          user_id: string;
          user_email: string;
          started_at: string;
          submitted_at: string | null;
          score: number | null;
          max_score: number | null;
        }[];
      };
      get_attempt_view: {
        Args: { p_attempt_id: string };
        Returns: {
          attemptId: string;
          assessmentId: string;
          assessmentTitle: string;
          startedAt: string;
          submittedAt: string | null;
          score: number | null;
          maxScore: number | null;
          pendingGradingCount: number;
          questions: {
            position: number;
            questionId: string;
            questionType: "single_choice" | "written";
            prompt: string;
            selectedOptionId: string | null;
            textResponse: string | null;
            isCorrectManual: boolean | null;
            gradingNote: string | null;
            answerGuide: string | null;
            explanation: string | null;
            options: { optionId: string; text: string; isCorrect?: boolean }[];
          }[];
        };
      };
      get_student_performance: {
        Args: { p_course_id: string };
        Returns: {
          assessmentsCompleted: number;
          questionsCorrect: number;
          questionsTotal: number;
          lectureBreakdown: { lecture_id: string; lecture_title: string; correct: number; total: number }[];
          topicBreakdown: { topic: string; correct: number; total: number }[];
        };
      };
      get_course_gradebook: {
        Args: { p_course_id: string };
        Returns: {
          user_id: string;
          user_email: string;
          assessment_id: string;
          assessment_title: string;
          assessment_kind: "mock_test" | "class_test" | "project";
          points_possible: number | null;
          contributes_to_grade: boolean;
          attempt_id: string | null;
          status: "not_started" | "in_progress" | "submitted";
          score: number | null;
          max_score: number | null;
          submitted_at: string | null;
        }[];
      };
      get_course_project_grades: {
        Args: { p_course_id: string };
        Returns: {
          user_id: string;
          project_id: string;
          group_id: string | null;
          group_name: string | null;
          score: number | null;
          max_score: number | null;
          feedback: string | null;
        }[];
      };
      get_course_performance: {
        Args: { p_course_id: string };
        Returns: {
          studentsSubmitted: number;
          totalStudents: number;
          averagePercent: number | null;
          medianPercent: number | null;
          lectureBreakdown: { lecture_id: string; lecture_title: string; correct: number; total: number }[];
          topicBreakdown: { topic: string; correct: number; total: number }[];
          questionBreakdown: {
            question_id: string;
            prompt: string;
            topic: string;
            lecture_title: string | null;
            correct: number;
            total: number;
            correct_pct: number;
          }[];
        };
      };
    };
  };
}
