// ... (Your existing imports and middleware code)
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const AWS = require('aws-sdk');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const port = 3000;
const SECRET_KEY = 'your_very_secret_key_here';

AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});
const s3 = new AWS.S3();
const S3_BUCKET = process.env.S3_BUCKET;

// Middleware
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '/')));

// SQLite database setup
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS profiles (
                email TEXT PRIMARY KEY,
                bio TEXT,
                education TEXT,
                skills TEXT,
                projects TEXT,
                profile_pic TEXT,
                points INTEGER DEFAULT 0,
                level INTEGER DEFAULT 0,
                position TEXT DEFAULT 'beginner'
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS skills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                skill TEXT NOT NULL,
                FOREIGN KEY(email) REFERENCES users(email)
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                content TEXT,
                images TEXT,
                video_url TEXT,
                likes INTEGER DEFAULT 0,
                comments TEXT, -- JSON array of comments
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS teams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                creator_email TEXT NOT NULL,
                project_name TEXT NOT NULL,
                project_description TEXT,
                project_category TEXT,
                detailed_brief TEXT,
                required_level TEXT,
                project_tags TEXT, -- JSON string of project tags
                total_members INTEGER,
                roles TEXT, -- JSON string of roles and counts, now including skills per role
                members TEXT, -- JSON string of joined members
                project_visibility TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(creator_email) REFERENCES users(email)
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_email TEXT NOT NULL,
                receiver_email TEXT NOT NULL,
                message TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // MODIFIED: Corrected join_requests table creation to include foreign keys
        db.run(`
            CREATE TABLE IF NOT EXISTS join_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                team_id INTEGER NOT NULL,
                requester_email TEXT NOT NULL,
                creator_email TEXT NOT NULL,
                requested_role TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(team_id) REFERENCES teams(id),
                FOREIGN KEY(requester_email) REFERENCES users(email),
                FOREIGN KEY(creator_email) REFERENCES users(email)
            )
        `);
        // END OF MODIFIED CODE
    }
});

const loggedInUsers = new Set();

function authenticateJWT(req, res, next) {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Not logged in or session expired.' });
    }
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid or expired token.' });
        }
        req.user = user;
        next();
    });
}

// All HTML routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/home/home.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'home', 'home.html'));
});

app.get('/home/connection.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'home', 'connection.html'));
});

app.get('/home/authentication/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'home', 'authentication', 'login.html'));
});

app.get('/home/authentication/signup.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'home', 'authentication', 'signup.html'));
});

app.get('/home/self/profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'home', 'self', 'profile.html'));
});

app.get('/project/projectwork.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'project', 'projectwork.html'));
});

app.get('/project/createteam.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'project', 'createteam.html'));
});

app.get('/project/requests.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'project', 'requests.html'));
});

// All API Endpoints
app.post('/api/chat/send', (req, res) => {
    const { sender_email, receiver_email, message } = req.body;
    if (!sender_email || !receiver_email || !message) {
        return res.status(400).json({ message: 'Missing fields.' });
    }
    db.run(`INSERT INTO chats (sender_email, receiver_email, message) VALUES (?, ?, ?)`, [sender_email, receiver_email, message], function(err) {
        if (err) {
            return res.status(500).json({ message: 'Database error.' });
        }
        res.status(201).json({ message: 'Message sent.' });
    });
});

app.get('/api/chat/messages', (req, res) => {
    const { user1, user2 } = req.query;
    if (!user1 || !user2) {
        return res.status(400).json({ message: 'Missing user emails.' });
    }
    db.all(`SELECT * FROM chats WHERE (sender_email = ? AND receiver_email = ?) OR (sender_email = ? AND receiver_email = ?) ORDER BY timestamp ASC`, [user1, user2, user2, user1], (err, rows) => {
        if (err) {
            return res.status(500).json({ message: 'Database error.' });
        }
        res.json(rows);
    });
});

app.get('/api/search/user', (req, res) => {
    const username = req.query.username;
    if (!username) {
        return res.status(400).json({ message: 'Username is required.' });
    }
    db.all(`SELECT name, email FROM users WHERE name LIKE ?`, [`%${username}%`], (err, rows) => {
        if (err) {
            return res.status(500).json({ message: 'Database error.' });
        }
        if (!rows || rows.length === 0) {
            return res.status(200).json([]);
        }
        const results = [];
        let pending = rows.length;
        rows.forEach(user => {
            db.get(`SELECT profile_pic FROM profiles WHERE email = ?`, [user.email], (err, profile) => {
                results.push({
                    name: user.name,
                    email: user.email,
                    profile_pic: profile && profile.profile_pic ? profile.profile_pic : ("https://i.pravatar.cc/150?u=" + user.email)
                });
                pending--;
                if (pending === 0) {
                    res.json(results);
                }
            });
        });
    });
});

app.post('/api/signup', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const stmt = db.prepare(`INSERT INTO users (name, email, password) VALUES (?, ?, ?)`);
        stmt.run(name, email, hashedPassword, function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(409).json({ message: 'Email already registered.' });
                }
                console.error(err);
                return res.status(500).json({ message: 'Database error.' });
            }
            res.status(201).json({ message: 'User registered successfully!' });
        });
        stmt.finalize();
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ message: 'Server error during signup.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err) {
            return res.status(500).json({ message: 'Database error.' });
        }
        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        try {
            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }

            const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '1h' });

            loggedInUsers.add(user.email);

            res.cookie('token', token, { httpOnly: true });
            res.status(200).json({
                message: 'Login successful!',
                token: token,
                redirectUrl: `/home/home.html?email=${encodeURIComponent(user.email)}`
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ message: 'Server error during login.' });
        }
    });
});

app.get('/api/profile/get-data', authenticateJWT, (req, res) => {
    const userEmail = req.user.email;
    db.get(`SELECT * FROM users WHERE email = ?`, [userEmail], (err, user) => {
        if (err) {
            return res.status(500).json({ message: 'Database error.' });
        }
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        db.get(`SELECT * FROM profiles WHERE email = ?`, [userEmail], (err, profile) => {
            const userData = {
                name: user.name,
                email: user.email,
                bio: profile && profile.bio ? profile.bio : '',
                profile_pic: profile && profile.profile_pic ? profile.profile_pic : ("https://i.pravatar.cc/150?u=" + userEmail),
                education: profile && profile.education ? JSON.parse(profile.education) : [],
                skills: profile && profile.skills ? JSON.parse(profile.skills) : [],
                projects: profile && profile.projects ? JSON.parse(profile.projects) : []
            };
            return res.status(200).json(userData);
        });
    });
});

function getLevelAndPosition(points) {
    let level = Math.floor(points / 50);
    let position = 'beginner';
    if (level >= 0 && level <= 4) position = 'beginner';
    else if (level >= 5 && level <= 8) position = 'intermediate';
    else if (level > 8) position = 'mentor';
    return { level, position };
}

app.post('/api/profile/update', authenticateJWT, (req, res) => {
    const { name, bio, education, skills, projects, profile_pic, points } = req.body;
    const email = req.user.email;
    const { level, position } = getLevelAndPosition(points || 0);
    db.run(`UPDATE users SET name = ? WHERE email = ?`, [name, email], function(err) {
        if (err) {
            return res.status(500).json({ message: 'Database error updating name.' });
        }
        db.run(`INSERT INTO profiles (email, bio, education, skills, projects, profile_pic, points, level, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(email) DO UPDATE SET bio=excluded.bio, education=excluded.education, skills=excluded.skills, projects=excluded.projects, profile_pic=excluded.profile_pic, points=excluded.points, level=excluded.level, position=excluded.position`,
            [email, bio || '', JSON.stringify(education || []), JSON.stringify(skills || []), JSON.stringify(projects || []), profile_pic || '', points || 0, level, position],
            function(err) {
                if (err) {
                    return res.status(500).json({ message: 'Database error updating profile.' });
                }
                if (Array.isArray(skills)) {
                    db.run(`DELETE FROM skills WHERE email = ?`, [email], function(err) {
                        if (err) {
                            return res.status(500).json({ message: 'Database error deleting skills.' });
                        }
                        const stmt = db.prepare(`INSERT INTO skills (email, skill) VALUES (?, ?)`);
                        skills.forEach(skill => {
                            if (skill && skill.trim()) {
                                stmt.run(email, skill.trim());
                            }
                        });
                        stmt.finalize();
                        return res.status(200).json({ message: 'Profile updated successfully!', email });
                    });
                } else {
                    return res.status(200).json({ message: 'Profile updated successfully!', email });
                }
            }
        );
    });
});

app.post('/api/profile/upload-photo', authenticateJWT, upload.single('profile_pic'), (req, res) => {
    const email = req.user.email;
    if (!req.file) {
        console.error('No file uploaded');
        return res.status(400).json({ message: 'No file uploaded.' });
    }
    const fileExt = req.file.originalname.split('.').pop();
    const s3Key = `profile-pics/${email}_${Date.now()}.${fileExt}`;
    const params = {
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
    };
    console.log('Uploading file:', req.file);
    console.log('S3 params:', params);
    s3.upload(params, (err, data) => {
        if (err) {
            console.error('S3 upload error:', err);
            return res.status(500).json({ message: 'S3 upload error: ' + err.message });
        }
        console.log('S3 upload success:', data);
        db.run(`UPDATE profiles SET profile_pic = ? WHERE email = ?`, [data.Location, email], function(err) {
            if (err) {
                console.error('Database error updating profile picture:', err);
                return res.status(500).json({ message: 'Database error updating profile picture.' });
            }
            console.log('Profile picture updated in DB for', email);
            return res.status(200).json({ message: 'Profile picture updated!', url: data.Location });
        });
    });
});

app.post('/api/post/upload-media', authenticateJWT, upload.single('media'), (req, res) => {
    const email = req.user.email;
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }
    const fileExt = req.file.originalname.split('.').pop();
    const type = req.file.mimetype.startsWith('video') ? 'videos' : 'images';
    const s3Key = `posts/${type}/${email}_${Date.now()}.${fileExt}`;
    const params = {
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype
    };
    s3.upload(params, (err, data) => {
        if (err) {
            console.error('S3 upload error:', err);
            return res.status(500).json({ message: 'S3 upload error: ' + err.message });
        }
        return res.status(200).json({ url: data.Location });
    });
});

app.post('/api/post/create', authenticateJWT, (req, res) => {
    const email = req.user.email;
    const { content, images, video_url } = req.body;
    console.log('Creating post for:', email);
    console.log('Content:', content);
    console.log('Images:', images);
    console.log('Video URL:', video_url);
    db.run(`INSERT INTO posts (email, content, images, video_url) VALUES (?, ?, ?, ?)`,
        [email, content || '', JSON.stringify(images || []), video_url ? video_url : null],
        function(err) {
            if (err) {
                console.error('DB error creating post:', err);
                return res.status(500).json({ message: 'Database error creating post.' });
            }
            db.get(`SELECT points FROM profiles WHERE email = ?`, [email], (err, row) => {
                let newPoints = 1;
                if (!err && row && typeof row.points === 'number') {
                    newPoints = row.points + 1;
                }
                const { level, position } = getLevelAndPosition(newPoints);
                db.run(`UPDATE profiles SET points = ?, level = ?, position = ? WHERE email = ?`, [newPoints, level, position, email], (err) => {
                    if (err) {
                        console.error('Error updating points/level:', err);
                    }
                    return res.status(201).json({ message: 'Post created successfully!', postId: this.lastID });
                });
            });
        }
    );
});

app.get('/api/posts/get', authenticateJWT, (req, res) => {
    const email = req.query.email;
    db.all(`SELECT * FROM posts WHERE email = ? ORDER BY created_at DESC`, [email], (err, rows) => {
        if (err) {
            console.error('Error fetching posts:', err);
            return res.status(500).json([]);
        }
        res.json(rows);
    });
});

app.get('/api/posts/feed', authenticateJWT, (req, res) => {
    db.all(`SELECT * FROM posts ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching feed:', err);
            return res.status(500).json([]);
        }
        res.json(rows);
    });
});

app.post('/api/posts/like', authenticateJWT, (req, res) => {
    const { postId } = req.body;
    db.run(`UPDATE posts SET likes = likes + 1 WHERE id = ?`, [postId], function(err) {
        if (err) {
            console.error('Error liking post:', err);
            return res.status(500).json({ message: 'Error liking post.' });
        }
        res.json({ message: 'Post liked!' });
    });
});

app.post('/api/posts/comment', authenticateJWT, (req, res) => {
    const { postId, comment, user } = req.body;
    db.get(`SELECT comments FROM posts WHERE id = ?`, [postId], (err, row) => {
        let comments = [];
        if (!err && row && row.comments) {
            try { comments = JSON.parse(row.comments); } catch {}
        }
        comments.push({ user, comment, date: new Date().toISOString() });
        db.run(`UPDATE posts SET comments = ? WHERE id = ?`, [JSON.stringify(comments), postId], function(err) {
            if (err) {
                console.error('Error adding comment:', err);
                return res.status(500).json({ message: 'Error adding comment.' });
            }
            res.json({ message: 'Comment added!' });
        });
    });
});

app.post('/api/teams/create', authenticateJWT, (req, res) => {
    const creator_email = req.user.email;
    const { projectName, projectDescription, projectCategory, detailedBrief, requiredLevel, roles, projectVisibility } = req.body;

    if (!projectName || !projectDescription || !projectCategory || !requiredLevel || !Array.isArray(roles) || !detailedBrief || !projectVisibility) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    let allProjectTags = [];
    roles.forEach(role => {
        if (role.skills && Array.isArray(role.skills)) {
            allProjectTags = allProjectTags.concat(role.skills);
        }
    });

    const rolesJson = JSON.stringify(roles);
    const projectTagsJson = JSON.stringify(allProjectTags);
    const totalMembers = roles.reduce((sum, role) => sum + parseInt(role.count, 10), 0) + 1;
    const creatorRole = req.body.creatorRole || 'Project Leader';
    const membersJson = JSON.stringify([{ email: creator_email, role: creatorRole }]);

    db.run(
        `INSERT INTO teams (creator_email, project_name, project_description, project_category, detailed_brief, required_level, project_tags, total_members, roles, members, project_visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))`,
        [creator_email, projectName, projectDescription, projectCategory, detailedBrief, requiredLevel, projectTagsJson, totalMembers, rolesJson, membersJson, projectVisibility],
        function(err) {
            if (err) {
                console.error('Database error creating team:', err);
                return res.status(500).json({ message: 'Database error creating team.' });
            }
            res.status(201).json({ message: 'Team created successfully!', teamId: this.lastID });
        }
    );
});

app.get('/api/teams/all', authenticateJWT, (req, res) => {
    db.all(`SELECT * FROM teams WHERE project_visibility = 'public' ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching all teams:', err);
            return res.status(500).json([]);
        }
        res.json(rows);
    });
});

app.get('/api/teams/created', authenticateJWT, (req, res) => {
    const userEmail = req.user.email;
    db.all(`SELECT * FROM teams WHERE creator_email = ? ORDER BY created_at DESC`, [userEmail], (err, rows) => {
        if (err) {
            console.error('Error fetching created teams:', err);
            return res.status(500).json([]);
        }
        res.json(rows);
    });
});

app.get('/api/teams/joined', authenticateJWT, (req, res) => {
    const userEmail = req.user.email;
    const searchString = `%"email":"${userEmail}"%`;
    db.all(`SELECT * FROM teams WHERE members LIKE ? ORDER BY created_at DESC`, [searchString], (err, rows) => {
        if (err) {
            console.error('Error fetching joined teams:', err);
            return res.status(500).json([]);
        }
        res.json(rows);
    });
});

// MODIFIED: Added a console log to the join-request endpoint to debug the issue
app.post('/api/teams/join-request', authenticateJWT, (req, res) => {
    const requester_email = req.user.email;
    const { teamId, requestedRole } = req.body;

    console.log('Received join request:', { requester_email, teamId, requestedRole });

    if (!teamId || !requestedRole) {
        return res.status(400).json({ message: 'Missing team ID or requested role.' });
    }

    db.get('SELECT creator_email, members FROM teams WHERE id = ?', [teamId], (err, team) => {
        if (err) {
            console.error('Database error fetching team:', err);
            return res.status(500).json({ message: 'Database error.' });
        }
        if (!team) {
            return res.status(404).json({ message: 'Team not found.' });
        }
        const members = JSON.parse(team.members);
        if (members.some(member => member.email === requester_email)) {
            return res.status(409).json({ message: 'You are already a member of this team.' });
        }

        db.get('SELECT id FROM join_requests WHERE team_id = ? AND requester_email = ? AND status = ?', [teamId, requester_email, 'pending'], (err, request) => {
            if (err) {
                console.error('Database error checking for existing request:', err);
                return res.status(500).json({ message: 'Database error.' });
            }
            if (request) {
                return res.status(409).json({ message: 'A pending request already exists for this team.' });
            }

            db.run(
                'INSERT INTO join_requests (team_id, requester_email, creator_email, requested_role, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
                [teamId, requester_email, team.creator_email, requestedRole],
                function(err) {
                    if (err) {
                        console.error('Error saving join request:', err);
                        return res.status(500).json({ message: 'Error saving join request.' });
                    }
                    res.status(201).json({ message: 'Join request sent successfully!', requestId: this.lastID });
                }
            );
        });
    });
});

app.get('/api/teams/join-requests', authenticateJWT, (req, res) => {
    const creator_email = req.user.email;
    db.all(
        `SELECT jr.id, jr.requester_email, jr.requested_role, jr.created_at, t.project_name, u.name as requester_name
         FROM join_requests jr
         JOIN teams t ON jr.team_id = t.id
         JOIN users u ON jr.requester_email = u.email
         WHERE jr.creator_email = ? AND jr.status = 'pending'
         ORDER BY jr.created_at DESC`,
        [creator_email],
        (err, rows) => {
            if (err) {
                console.error('Error fetching join requests:', err);
                return res.status(500).json([]);
            }
            res.json(rows);
        }
    );
});

app.post('/api/teams/update-join-request', authenticateJWT, (req, res) => {
    const { requestId, action } = req.body;
    const creator_email = req.user.email;

    if (!requestId || !action || (action !== 'approve' && action !== 'reject')) {
        return res.status(400).json({ message: 'Invalid request data.' });
    }

    db.get('SELECT * FROM join_requests WHERE id = ? AND creator_email = ? AND status = ?', [requestId, creator_email, 'pending'], (err, request) => {
        if (err) {
            console.error('DB error fetching request:', err);
            return res.status(500).json({ message: 'Database error.' });
        }
        if (!request) {
            return res.status(404).json({ message: 'Request not found or not authorized.' });
        }

        db.run('UPDATE join_requests SET status = ? WHERE id = ?', [action, requestId], function(err) {
            if (err) {
                console.error('Error updating request status:', err);
                return res.status(500).json({ message: 'Database error.' });
            }

            if (action === 'approve') {
                db.get('SELECT members, roles FROM teams WHERE id = ?', [request.team_id], (err, team) => {
                    if (err || !team) {
                        return res.status(500).json({ message: 'Failed to find team to approve member.' });
                    }

                    const members = JSON.parse(team.members);
                    const roles = JSON.parse(team.roles);
                    const newMember = { email: request.requester_email, role: request.requested_role };

                    members.push(newMember);

                    const updatedRoles = roles.map(role =>
                        role.name === request.requested_role ? { ...role, count: role.count - 1 } : role
                    );

                    db.run('UPDATE teams SET members = ?, roles = ? WHERE id = ?', [JSON.stringify(members), JSON.stringify(updatedRoles), request.team_id], function(err) {
                        if (err) {
                            console.error('Error updating team members after approval:', err);
                            return res.status(500).json({ message: 'Database error approving member.' });
                        }
                        res.status(200).json({ message: 'Request approved and member added successfully!' });
                    });
                });
            } else {
                res.status(200).json({ message: 'Request rejected successfully!' });
            }
        });
    });
});


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});