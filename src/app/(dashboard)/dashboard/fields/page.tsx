import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Flag, Plus, MapPin } from "lucide-react";
import type { Venue } from "@/types/database";

export default async function FieldsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: rawVenues } = await supabase
    .from("venues")
    .select("*")
    .eq("owner_id", user!.id)
    .order("name", { ascending: true });

  const fields = (rawVenues ?? []) as Venue[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0C1F3F]">Fields</h1>
          <p className="mt-1 text-sm text-gray-500">Manage playing fields and facilities.</p>
        </div>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add field
        </Button>
      </div>

      {fields.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Flag className="mb-4 h-10 w-10 text-gray-300" />
            <h3 className="font-semibold text-gray-900">No fields yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Add fields so you can assign them to divisions and schedule games.
            </p>
            <Button className="mt-4" size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add field
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field) => (
            <div
              key={field.id}
              className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#0C1F3F]/[0.07]">
                  <Flag className="h-4 w-4 text-[#0C1F3F]" />
                </div>
              </div>
              <div>
                <p className="font-semibold text-gray-900">{field.name}</p>
                {(field.address || field.city || field.state) && (
                  <div className="mt-1 flex items-start gap-1 text-sm text-gray-500">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span>
                      {[field.address, field.city, field.state]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </div>
                )}
                {field.capacity && (
                  <p className="mt-1 text-xs text-gray-400">
                    Capacity: {field.capacity.toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
