import { AISection } from "@/components/marketing/ai-section";
import { Features } from "@/components/marketing/features";
import { FinalCta } from "@/components/marketing/final-cta";
import { Footer } from "@/components/marketing/footer";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Navbar } from "@/components/marketing/navbar";
import { UseCases } from "@/components/marketing/use-cases";

export default function Home() {
  return (
    <div className="flex min-h-svh flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Features />
        <AISection />
        <HowItWorks />
        <UseCases />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
