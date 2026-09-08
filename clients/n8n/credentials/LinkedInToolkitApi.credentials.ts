import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * The pairing token from `~/.linkedin-toolkit/config.json`, plus the URL the
 * server is listening on.
 *
 * The same credential works with the plain HTTP Request node, so a workflow can
 * reach an action this package's node has not caught up with yet.
 */
export class LinkedInToolkitApi implements ICredentialType {
	name = 'linkedInToolkitApi';

	displayName = 'LinkedIn Toolkit API';

	documentationUrl = 'https://github.com/OpenRecruiterTools/linkedin-toolkit/blob/master/docs/agents/n8n.md';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://127.0.0.1:47830',
			required: true,
			description:
				'Where `lit serve --http` is listening. Inside Docker, 127.0.0.1 is the container: use http://host.docker.internal:47830 on Docker Desktop, or run n8n with --network host on Linux.',
		},
		{
			displayName: 'Token',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'The pairing token — the `token` field in ~/.linkedin-toolkit/config.json, or the value `lit config get token --reveal` prints.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.token}}',
			},
		},
	};

	/**
	 * `/health` needs no token, so a passing test proves the URL is reachable
	 * rather than that the token is right. That is still the failure worth
	 * catching first: almost every setup problem here is the port or Docker
	 * networking, not the token.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/health',
			method: 'GET',
		},
	};
}
