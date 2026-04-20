// server.js - NCMI Backend API
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// MongoDB Connection
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ncmi');
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error('MongoDB connection error:', error);
        // Continue without DB for demo purposes
        console.log('Running without database - submissions will be logged to console');
    }
};

// MongoDB Schema
const contactSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    company: String,
    interest: { type: String, required: true },
    message: String,
    createdAt: { type: Date, default: Date.now },
    status: { type: String, default: 'pending' }
});

const Contact = mongoose.models.Contact || mongoose.model('Contact', contactSchema);

// In-memory storage for demo (when MongoDB is not available)
const demoSubmissions = [];

// Email transporter setup
const createTransporter = () => {
    if (process.env.EMAIL_USER && process.env.EMAIL_USER !== 'your-email@gmail.com') {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }
    return null;
};

const transporter = createTransporter();

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Submit contact form
app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, company, interest, message } = req.body;

        // Validation
        if (!name || !email || !interest) {
            return res.status(400).json({ 
                error: 'Name, email, and interest are required' 
            });
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                error: 'Please provide a valid email address' 
            });
        }

        const formData = {
            name,
            email,
            company,
            interest,
            message,
            createdAt: new Date().toISOString()
        };

        // Try to save to database
        try {
            const contact = new Contact(formData);
            await contact.save();
            formData.id = contact._id;
        } catch (dbError) {
            // Store in memory for demo
            formData.id = Date.now().toString();
            demoSubmissions.push(formData);
            console.log('Stored in memory (DB unavailable):', formData);
        }

        // Try to send email notification
        if (transporter && process.env.ADMIN_EMAIL) {
            try {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: process.env.ADMIN_EMAIL,
                    subject: 'New Contact Form Submission - NCMI',
                    html: `
                        <h2>New Contact Form Submission</h2>
                        <p><strong>Name:</strong> ${name}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Company:</strong> ${company || 'N/A'}</p>
                        <p><strong>Interest:</strong> ${interest}</p>
                        <p><strong>Message:</strong> ${message || 'N/A'}</p>
                        <p><strong>Submitted at:</strong> ${new Date().toLocaleString()}</p>
                    `
                });
                console.log('Admin notification email sent');
            } catch (emailError) {
                console.error('Email sending failed:', emailError);
            }

            // Send confirmation to user
            try {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: email,
                    subject: 'Thank you for contacting NCMI',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #1a5f3f;">Thank you for your interest in NCMI</h2>
                            <p>Dear ${name},</p>
                            <p>We have received your inquiry regarding <strong>${interest}</strong>. 
                            Our team will review your message and get back to you within 2 business days.</p>
                            <div style="background: #f5f5dc; padding: 20px; border-radius: 10px; margin: 20px 0;">
                                <p style="margin: 0;"><strong>Your submission details:</strong></p>
                                <p style="margin: 5px 0;">Interest: ${interest}</p>
                                <p style="margin: 5px 0;">Submitted: ${new Date().toLocaleString()}</p>
                            </div>
                            <p>Best regards,<br><strong>NCMI Team</strong><br>
                            National Company for Military & Industrial Innovation</p>
                        </div>
                    `
                });
                console.log('User confirmation email sent');
            } catch (emailError) {
                console.error('Confirmation email failed:', emailError);
            }
        }

        res.status(201).json({ 
            success: true, 
            message: 'Contact form submitted successfully',
            id: formData.id
        });

    } catch (error) {
        console.error('Contact form error:', error);
        res.status(500).json({ 
            error: 'Failed to submit contact form. Please try again later.' 
        });
    }
});

// Get all submissions (Admin endpoint)
app.get('/api/submissions', async (req, res) => {
    try {
        let submissions;
        try {
            submissions = await Contact.find()
                .sort({ createdAt: -1 })
                .limit(100);
        } catch (dbError) {
            submissions = demoSubmissions.sort((a, b) => 
                new Date(b.createdAt) - new Date(a.createdAt)
            );
        }
        res.json({
            count: submissions.length,
            submissions
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch submissions' });
    }
});

// Update submission status
app.patch('/api/submissions/:id', async (req, res) => {
    try {
        const { status } = req.body;
        
        if (!['pending', 'reviewed', 'contacted', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        let submission;
        try {
            submission = await Contact.findByIdAndUpdate(
                req.params.id,
                { status },
                { new: true }
            );
        } catch (dbError) {
            const index = demoSubmissions.findIndex(s => s.id === req.params.id);
            if (index !== -1) {
                demoSubmissions[index].status = status;
                submission = demoSubmissions[index];
            }
        }
        
        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        
        res.json({ success: true, submission });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update submission' });
    }
});

// Delete submission
app.delete('/api/submissions/:id', async (req, res) => {
    try {
        try {
            await Contact.findByIdAndDelete(req.params.id);
        } catch (dbError) {
            const index = demoSubmissions.findIndex(s => s.id === req.params.id);
            if (index !== -1) {
                demoSubmissions.splice(index, 1);
            }
        }
        res.json({ success: true, message: 'Submission deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete submission' });
    }
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const startServer = async () => {
    await connectDB();
    
    app.listen(PORT, () => {
        console.log('='.repeat(60));
        console.log('  NCMI - National Company for Military & Industrial Innovation');
        console.log('='.repeat(60));
        console.log(`  Server running on: http://localhost:${PORT}`);
        console.log(`  Health check: http://localhost:${PORT}/api/health`);
        console.log(`  API endpoint: http://localhost:${PORT}/api/contact`);
        console.log(`  Submissions: http://localhost:${PORT}/api/submissions`);
        console.log('='.repeat(60));
        console.log('  Press Ctrl+C to stop the server');
        console.log('='.repeat(60));
    });
};

startServer();
