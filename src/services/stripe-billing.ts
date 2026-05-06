import Stripe from 'stripe';
import { neon } from '@neondatabase/serverless';

export interface SubscriptionTier {
  name: string;
  priceId: string;
  amount: number;
  currency: string;
  interval: 'month' | 'year';
  features: string[];
}

export interface StripeBillingConfig {
  starterPriceId: string;
  proPriceId: string;
  scalePriceId: string;
  databaseUrl: string;
}

export const getSubscriptionTiers = (config: StripeBillingConfig): Record<string, SubscriptionTier> => ({
  starter: {
    name: 'Starter',
    priceId: config.starterPriceId,
    amount: 9900,
    currency: 'usd',
    interval: 'month',
    features: ['5,000 API calls/month', 'Basic model benchmarks', 'Email support'],
  },
  pro: {
    name: 'Pro',
    priceId: config.proPriceId,
    amount: 29900,
    currency: 'usd',
    interval: 'month',
    features: ['50,000 API calls/month', 'Advanced benchmarks', 'Priority support', 'Custom integrations'],
  },
  scale: {
    name: 'Scale',
    priceId: config.scalePriceId,
    amount: 49900,
    currency: 'usd',
    interval: 'month',
    features: ['Unlimited API calls', 'Full data access', 'Dedicated support', 'SLA guarantee', 'Custom models'],
  },
});

export class StripeBillingService {
  private stripe: Stripe;
  private tiers: Record<string, SubscriptionTier>;
  private databaseUrl: string;

  constructor(secretKey: string, config: StripeBillingConfig) {
    this.stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' as any });
    this.tiers = getSubscriptionTiers(config);
    this.databaseUrl = config.databaseUrl;
  }

  async createCheckoutSession(customerId: string | undefined, tier: string, successUrl: string, cancelUrl: string) {
    const tierConfig = this.tiers[tier.toLowerCase()];
    if (!tierConfig) throw new Error(`Invalid tier: ${tier}`);

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: tierConfig.priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { tier },
    });

    return session;
  }

  async createCustomer(email: string, name?: string) {
    return this.stripe.customers.create({ email, name });
  }

  async findOrCreateCustomer(email: string): Promise<Stripe.Customer> {
    const customers = await this.stripe.customers.list({ email, limit: 1 });
    if (customers.data.length > 0) {
      return customers.data[0] as Stripe.Customer;
    }
    return this.stripe.customers.create({ email }) as Promise<Stripe.Customer>;
  }

  async getSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  async cancelSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.cancel(subscriptionId);
  }

  async handleWebhookEvent(payload: string, signature: string, webhookSecret: string) {
    const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.updateSubscriptionInDb(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_succeeded':
        console.log('Payment succeeded:', event.data.object);
        break;
      case 'invoice.payment_failed':
        console.log('Payment failed:', event.data.object);
        break;
    }

    return event;
  }

  private async updateSubscriptionInDb(subscription: Stripe.Subscription) {
    const sql = neon(this.databaseUrl);
    await sql`
      INSERT INTO subscriptions (customer_id, subscription_id, tier, status, current_period_end)
      VALUES (${subscription.customer as string}, ${subscription.id}, ${subscription.metadata.tier || 'unknown'}, ${subscription.status}, ${new Date(subscription.current_period_end * 1000)})
      ON CONFLICT (subscription_id) DO UPDATE SET
        tier = EXCLUDED.tier,
        status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end
    `;
  }
}
