import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 border-border bg-card">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">404 — Not Found</h1>
          </div>
          <p className="mt-4 text-sm text-muted-foreground font-mono">
            This page does not exist. Check the URL or return to the dashboard.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
