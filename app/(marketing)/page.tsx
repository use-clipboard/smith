import Panel from '@/components/marketing/Panel';
import Reveal from '@/components/marketing/Reveal';
import Hero from '@/components/marketing/Hero';
import ToolsGrid from '@/components/marketing/ToolsGrid';
import ToolShowcase from '@/components/marketing/ToolShowcase';
import PainPoints from '@/components/marketing/PainPoints';
import VideoSection from '@/components/marketing/VideoSection';
import PricingCalculator from '@/components/marketing/PricingCalculator';
import OurStory from '@/components/marketing/OurStory';
import Faq from '@/components/marketing/Faq';
import FinalCta from '@/components/marketing/FinalCta';

export default function MarketingHomePage() {
  return (
    <>
      {/* Hero reveals immediately on load (already in view); the rest rise in
          as they scroll into the viewport. */}
      <Reveal y={16}>
        <Panel>
          <Hero />
        </Panel>
      </Reveal>

      {/* "Everything you need" + pain points share one panel, mirroring the
          mockup's large lower-left card. */}
      <Reveal>
        <Panel id="tools">
          <ToolsGrid />
          <PainPoints />
        </Panel>
      </Reveal>

      <Reveal>
        <Panel id="showcase">
          <ToolShowcase />
        </Panel>
      </Reveal>

      <Reveal>
        <Panel id="video">
          <VideoSection />
        </Panel>
      </Reveal>

      <Reveal>
        <Panel id="pricing">
          <PricingCalculator />
        </Panel>
      </Reveal>

      <Reveal>
        <Panel id="story">
          <OurStory />
        </Panel>
      </Reveal>

      <Reveal>
        <Panel id="faq">
          <Faq />
        </Panel>
      </Reveal>

      <Reveal>
        <FinalCta />
      </Reveal>
    </>
  );
}
