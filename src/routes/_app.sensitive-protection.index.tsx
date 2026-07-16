import { createFileRoute, Link } from "@tanstack/react-router";
import { SensitiveAccessGate } from "@/components/sensitive-protection/AccessGate";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Image, Activity, FileText, Settings } from "lucide-react";

export const Route = createFileRoute("/_app/sensitive-protection/")({
  component: SensitiveProtectionDashboard,
  head: () => ({ meta: [{ title: "Intimate Image & Deepfake Protection · Eterna AI" }] }),
});

function SensitiveProtectionDashboard() {
  return (
    <SensitiveAccessGate>
      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold font-display text-white mb-2">Intimate Image & Deepfake Protection</h1>
          <p className="text-white/60">Secure monitoring for unauthorized AI-generated explicit content, manipulated media, and deepfakes.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link to="/sensitive-protection/results">
            <Card className="bg-[#0A1128] border-white/10 hover:bg-white/5 transition h-full cursor-pointer">
              <CardContent className="p-6">
                <div className="size-10 bg-blue-500/10 rounded-lg flex items-center justify-center mb-4 border border-blue-500/20">
                  <Image className="size-5 text-blue-400" />
                </div>
                <h3 className="font-semibold text-white">Review Results</h3>
                <p className="text-sm text-white/50 mt-1">Review discovered potential matches (blurred by default).</p>
              </CardContent>
            </Card>
          </Link>

          <Link to="/sensitive-protection/emergency">
            <Card className="bg-[#0A1128] border-red-500/20 hover:bg-red-500/10 transition h-full cursor-pointer">
              <CardContent className="p-6">
                <div className="size-10 bg-red-500/10 rounded-lg flex items-center justify-center mb-4 border border-red-500/30">
                  <ShieldAlert className="size-5 text-red-400" />
                </div>
                <h3 className="font-semibold text-white">Emergency Mode</h3>
                <p className="text-sm text-white/50 mt-1">Activate rapid scanning and prioritize reviews.</p>
              </CardContent>
            </Card>
          </Link>

          <Link to="/sensitive-protection/removal-cases">
            <Card className="bg-[#0A1128] border-white/10 hover:bg-white/5 transition h-full cursor-pointer">
              <CardContent className="p-6">
                <div className="size-10 bg-emerald-500/10 rounded-lg flex items-center justify-center mb-4 border border-emerald-500/20">
                  <FileText className="size-5 text-emerald-400" />
                </div>
                <h3 className="font-semibold text-white">Removal Cases</h3>
                <p className="text-sm text-white/50 mt-1">Track prepared complaints and active takedowns.</p>
              </CardContent>
            </Card>
          </Link>

          <Card className="bg-[#0A1128] border-white/10 h-full">
            <CardContent className="p-6">
              <div className="size-10 bg-purple-500/10 rounded-lg flex items-center justify-center mb-4 border border-purple-500/20">
                <Settings className="size-5 text-purple-400" />
              </div>
              <h3 className="font-semibold text-white">Profile & Consent</h3>
              <p className="text-sm text-white/50 mt-1 mb-4">Manage monitoring aliases and sensitive processing consent.</p>
              <Button variant="outline" size="sm" className="w-full border-white/10 hover:bg-white/10 text-white">Configure</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </SensitiveAccessGate>
  );
}
