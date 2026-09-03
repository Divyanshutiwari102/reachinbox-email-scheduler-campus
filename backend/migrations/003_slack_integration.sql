-- Create table for Slack OAuth connections
CREATE TABLE slack_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID NOT NULL REFERENCES senders(id) ON DELETE CASCADE UNIQUE,
    access_token TEXT NOT NULL,
    webhook_url TEXT NOT NULL,
    channel TEXT,
    team_name TEXT,
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);