const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { isAuthenticated, isRenter } = require('../middleware/auth');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const Property = require('../models/Property');

// Create payment intent
router.post('/create-payment-intent', isAuthenticated, isRenter, async (req, res) => {
    try {
        const { bookingId } = req.body;
        
        const booking = await Booking.findOne({
            _id: bookingId,
            renter: req.session.user._id,
            status: 'pending',
            paymentStatus: 'pending'
        }).populate('property');

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(booking.totalPrice * 100), // Convert to cents and ensure integer
            currency: 'usd',
            metadata: {
                bookingId: booking._id.toString(),
                propertyId: booking.property._id.toString(),
                renterId: booking.renter.toString(),
                ownerId: booking.owner.toString(),
                priceDetails: JSON.stringify(booking.priceDetails)
            }
        });

        // Create payment record
        const payment = new Payment({
            booking: booking._id,
            property: booking.property._id,
            renter: booking.renter,
            owner: booking.owner,
            amount: booking.totalPrice,
            priceDetails: booking.priceDetails,
            stripePaymentIntentId: paymentIntent.id,
            stripeClientSecret: paymentIntent.client_secret,
            paymentMethod: 'card'
        });

        await payment.save();

        res.json({
            clientSecret: paymentIntent.client_secret,
            paymentId: payment._id,
            priceDetails: booking.priceDetails
        });
    } catch (error) {
        console.error('Payment Intent Error:', error);
        res.status(500).json({ error: 'Error creating payment intent' });
    }
});

// Webhook to handle Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook Error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            await handlePaymentSuccess(paymentIntent);
            break;
        case 'payment_intent.payment_failed':
            const failedPayment = event.data.object;
            await handlePaymentFailure(failedPayment);
            break;
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
});

// Process refund
router.post('/refund', isAuthenticated, async (req, res) => {
    try {
        const { paymentId, reason } = req.body;

        const payment = await Payment.findOne({
            _id: paymentId,
            status: 'succeeded'
        });

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        // Check if user is authorized (either renter or owner)
        if (payment.renter.toString() !== req.session.user._id.toString() &&
            payment.owner.toString() !== req.session.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Process refund through Stripe
        const refund = await stripe.refunds.create({
            payment_intent: payment.stripePaymentIntentId,
            reason: 'requested_by_customer'
        });

        // Update payment record
        payment.status = 'refunded';
        payment.refundId = refund.id;
        payment.refundAmount = refund.amount / 100;
        payment.refundReason = reason;
        await payment.save();

        // Update booking status
        const booking = await Booking.findById(payment.booking);
        if (booking) {
            booking.status = 'cancelled';
            booking.cancelledAt = Date.now();
            await booking.save();
        }

        res.json({ message: 'Refund processed successfully', refund });
    } catch (error) {
        console.error('Refund Error:', error);
        res.status(500).json({ error: 'Error processing refund' });
    }
});

// Get payment status
router.get('/:paymentId/status', isAuthenticated, async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.paymentId);
        
        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        if (payment.renter.toString() !== req.session.user._id.toString() &&
            payment.owner.toString() !== req.session.user._id.toString()) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        res.json({
            status: payment.status,
            receiptUrl: payment.receiptUrl
        });
    } catch (error) {
        console.error('Payment Status Error:', error);
        res.status(500).json({ error: 'Error fetching payment status' });
    }
});

// Helper functions
async function handlePaymentSuccess(paymentIntent) {
    try {
        const payment = await Payment.findOne({
            stripePaymentIntentId: paymentIntent.id
        });

        if (payment) {
            payment.status = 'succeeded';
            payment.receiptUrl = paymentIntent.charges.data[0]?.receipt_url;
            await payment.save();

            // Update booking status
            const booking = await Booking.findById(payment.booking);
            if (booking) {
                booking.status = 'confirmed';
                booking.paymentStatus = 'paid';
                booking.confirmedAt = new Date();
                await booking.save();

                // Send confirmation email to both renter and owner (implement later)
            }
        }
    } catch (error) {
        console.error('Payment Success Handler Error:', error);
    }
}

async function handlePaymentFailure(paymentIntent) {
    try {
        const payment = await Payment.findOne({
            stripePaymentIntentId: paymentIntent.id
        });

        if (payment) {
            payment.status = 'failed';
            await payment.save();

            // Update booking status
            const booking = await Booking.findById(payment.booking);
            if (booking) {
                booking.paymentStatus = 'failed';
                await booking.save();
            }
        }
    } catch (error) {
        console.error('Payment Failure Handler Error:', error);
    }
}

module.exports = router; 