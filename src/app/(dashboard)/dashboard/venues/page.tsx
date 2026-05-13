import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, MapPin } from "lucide-react";
import type { Venue } from "@/types/database";

export default async function VenuesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: rawVenues } = await supabase
    .from("venues")
    .select("*")
    .eq("owner_id", user!.id)
    .order("name", { ascending: true });
  const venues = rawVenues as Venue[] | null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Venues</h1>
          <p className="mt-1 text-sm text-gray-500">Manage fields and facilities.</p>
        </div>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add venue
        </Button>
      </div>

      {!venues || venues.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <MapPin className="mb-4 h-10 w-10 text-gray-300" />
            <h3 className="font-semibold text-gray-900">No venues yet</h3>
            <p className="mt-1 text-sm text-gray-500">Add your first venue to assign games to fields.</p>
            <Button className="mt-4" size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add venue
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {venues.map((venue) => (
            <Card key={venue.id} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle className="text-base">{venue.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-1 text-sm text-gray-500">
                  {venue.address && <p>{venue.address}</p>}
                  {(venue.city || venue.state) && (
                    <p>{[venue.city, venue.state].filter(Boolean).join(", ")}</p>
                  )}
                  {venue.capacity && <p>{venue.capacity.toLocaleString()} capacity</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
