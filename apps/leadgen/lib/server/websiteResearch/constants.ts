export const WEBSITE_RESEARCH_PATHS = [
  "/",
  "/pricing",
  "/product",
  "/products",
  "/platform",
  "/solutions",
  "/customers",
  "/case-studies",
  "/services",
  "/about",
  "/contact",
] as const;

export const WEBSITE_RESEARCH_TIMEOUT_MS = 7000;
export const WEBSITE_RESEARCH_MAX_BYTES = 250_000;
export const WEBSITE_RESEARCH_MAX_REDIRECTS = 5;
export const WEBSITE_RESEARCH_MAX_EVIDENCE_PER_CATEGORY = 8;

export type SignalGroupKey =
  | "productSignals"
  | "serviceSignals"
  | "pricingSignals"
  | "apiSignals"
  | "aiSignals"
  | "cloudSignals"
  | "dataSignals"
  | "securitySignals"
  | "parkedSignals";

export type SignalDefinition = {
  category: string;
  keywords: string[];
};

export const SIGNAL_DEFINITIONS: Record<SignalGroupKey, SignalDefinition> = {
  productSignals: {
    category: "product",
    keywords: [
      "platform",
      "software platform",
      "product",
      "product suite",
      "dashboard",
      "workflow",
      "workflow automation",
      "automation",
      "integration",
      "integrations",
      "software",
      "SaaS",
      "subscription",
      "cloud software",
      "web app",
      "platform as a service",
      "PaaS",
      "developer platform",
      "infrastructure platform",
      "deployment platform",
      "application platform",
      "build on our platform",
      "cloud platform",
      "blockchain",
      "web3",
      "smart contract",
      "crypto infrastructure",
      "tokenization",
      "wallet infrastructure",
      "decentralized application",
      "dApp",
      "NFT platform",
    ],
  },
  serviceSignals: {
    category: "service",
    keywords: [
      "IT outsourcing",
      "consulting",
      "agency",
      "outsourcing",
      "staffing",
      "staff augmentation",
      "custom software development",
      "software development services",
      "managed services",
      "IT services",
      "recruitment",
      "offshore development",
      "dedicated developers",
      "AI consulting",
      "AI development services",
      "machine learning consulting",
      "custom AI solutions",
      "AI implementation services",
      "AI agency",
      "AI outsourcing",
    ],
  },
  pricingSignals: {
    category: "pricing",
    keywords: [
      "pricing",
      "plans",
      "free trial",
      "request demo",
      "book a demo",
    ],
  },
  apiSignals: {
    category: "api",
    keywords: [
      "API",
      "developer",
      "developer platform",
      "docs",
      "SDK",
      "integration",
      "integrations",
    ],
  },
  aiSignals: {
    category: "ai",
    keywords: [
      "AI",
      "AI platform",
      "AI automation",
      "AI model",
      "artificial intelligence",
      "artificial intelligence platform",
      "machine learning",
      "machine learning platform",
      "machine learning model",
      "ML",
      "model training",
      "LLM",
      "large language model",
      "computer vision",
      "natural language processing",
      "NLP",
      "generative AI",
      "predictive analytics",
      "recommendation engine",
    ],
  },
  cloudSignals: {
    category: "cloud",
    keywords: [
      "cloud",
      "cloud infrastructure",
      "cloud migration",
      "cloud native",
      "managed cloud",
      "infrastructure",
      "infrastructure automation",
      "migration",
      "DevOps",
      "Kubernetes",
      "AWS",
      "Azure",
      "Google Cloud",
      "GCP",
      "cloud security",
    ],
  },
  dataSignals: {
    category: "data",
    keywords: [
      "data platform",
      "analytics platform",
      "analytics",
      "data pipeline",
      "data warehouse",
      "warehouse",
      "ETL",
      "ELT",
      "data integration",
      "customer data platform",
      "CDP",
      "reporting dashboard",
      "data engineering",
      "BI",
      "business intelligence",
    ],
  },
  securitySignals: {
    category: "security",
    keywords: [
      "security",
      "cybersecurity",
      "cyber security",
      "compliance",
      "SOC 2",
      "ISO 27001",
      "threat",
      "threat detection",
      "vulnerability",
      "penetration testing",
      "SIEM",
      "endpoint security",
      "identity security",
      "access management",
    ],
  },
  parkedSignals: {
    category: "parked",
    keywords: [
      "parked domain",
      "domain for sale",
      "buy this domain",
      "coming soon",
      "default hosting page",
      "under construction",
      "personal blog",
      "portfolio only",
      "ecommerce store only",
      "restaurant menu only",
      "local shop only",
      "no company information",
      "contact only",
    ],
  },
};
