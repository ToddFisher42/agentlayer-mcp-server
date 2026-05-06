import Stripe from 'stripe';

export interface SubscriptionTier {
  name: string;
  priceId: string;
  amount: number;
  currency: string;
  interval: 'month' | 'year';
  features: string[];
}

export const SUBSCRIPTION_TIERS: Record<string, SubscriptionTier> = {
  starter: {
    name: 'Starter',
    priceId: process.env.STRIPE_STARTER_PRICE_ID!,
    amount: 9900, // $99.00
    currency: 'usd',
    interval: 'month',
    features: ['5,000 API calls/month', 'Basic model benchmarks', 'Email support'],
  },
  pro: {
    name: 'Pro',
    priceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID!,
    amount: 29900, // $299.00
    currency: 'usd',
    interval: 'month',
    features: ['50,000 API calls/month', 'Advanced benchmarks', 'Priority support', 'Custom integrations'],
  },
  scale: {
    name: 'Scale',
    priceId: process.env.STRIPE_SCALE_MONTHLY_PRICE_ID!,
    amount: 49900, // $499.00
    currency: 'usd',
    interval: 'month',
    features: ['Unlimited API calls', 'Full data access', 'Dedicated support', 'SLA guarantee', 'Custom models'],
  },
};

export class StripeBillingService {
  private stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' as any });
  }

  async createCheckoutSession(customerId: string | undefined, tier: string, successUrl: string, cancelUrl: string) {
    const tierConfig = SUBSCRIPTION_TIERS[tier.toLowerCase()];
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

  async getSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  async cancelSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.cancel(subscriptionId);
  }

  async handleWebhookEvent(payload: Buffer, signature: string, webhookSecret: string) {
    const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        const subscription = event.data.object as Stripe.Subscription;
        await this.updateSubscriptionInDb(subscription);
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
    const sql = (await import('@neondatabase/serverless')).neon(process.env.NEON_DATABASE_URL!);
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
