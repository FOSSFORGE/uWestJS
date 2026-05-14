# HTTP Routing

Complete guide to routing in uWestJS with NestJS decorators and middleware.

## Table of Contents

- [Overview](#overview)
- [Route Registration](#route-registration)
- [Path Parameters](#path-parameters)
- [Query Parameters](#query-parameters)
- [Route Middleware](#route-middleware)
- [Guards](#guards)
- [Pipes](#pipes)
- [Filters](#filters)
- [Execution Order](#execution-order)
- [Examples](#examples)

---

## Overview

uWestJS provides full routing support with NestJS decorators:

- **HTTP Methods** - GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD
- **Path Parameters** - Dynamic route segments
- **Query Parameters** - URL query string parsing
- **Middleware** - Guards, Pipes, Filters, Interceptors
- **Wildcard Routes** - Catch-all routes
- **Route Versioning** - API versioning support

---

## Usage Models

uWestJS supports two distinct routing usage models for HTTP, similar to its WebSocket implementation:

### 1. NestJS Controller Pipeline (Standard)
This is the standard approach using NestJS decorators (`@Controller()`, `@Get()`, etc.). The NestJS framework automatically parses your classes, configures the route registry, and wraps your methods in its internal execution pipeline. This is the recommended approach for almost all applications.

### 2. Direct Registry Registration (Advanced)
For advanced use cases requiring programmatic route creation outside of NestJS controllers, uWestJS provides an adapter API via `UwsPlatformAdapter.addRoute()`. This allows you to manually register routes while still executing standard NestJS guards, pipes, and filters.

```typescript
// Advanced usage: Direct registration
const adapter = app.getHttpAdapter() as UwsPlatformAdapter;

adapter.addRoute('GET', '/health', (req, res) => {
  res.send({ status: 'ok' });
}, {
  guards: [CustomAuthGuard],
  pipes: [CustomValidationPipe],
  filters: [CustomExceptionFilter]
});
```

---

## Route Registration

### Basic Routes

Use NestJS decorators to define routes:

```typescript
import { Controller, Get, Post, Put, Delete, Patch } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Get()
  findAll() {
    return { users: [] };
  }
  
  @Get(':id')
  findOne(@Param('id') id: string) {
    return { user: { id } };
  }
  
  @Post()
  create(@Body() data: any) {
    return { created: true, data };
  }
  
  @Put(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return { updated: true, id, data };
  }
  
  @Delete(':id')
  remove(@Param('id') id: string) {
    return { deleted: true, id };
  }
  
  @Patch(':id')
  patch(@Param('id') id: string, @Body() data: any) {
    return { patched: true, id, data };
  }
}
```

### Route Paths

Routes are automatically prefixed with the controller path:

```typescript
@Controller('api/v1/users')
export class UsersController {
  @Get() // Matches: GET /api/v1/users
  findAll() { }
  
  @Get(':id') // Matches: GET /api/v1/users/:id
  findOne() { }
  
  @Get('profile/:id') // Matches: GET /api/v1/users/profile/:id
  getProfile() { }
}
```

### HTTP Methods

All standard HTTP methods are supported:

```typescript
@Controller('api')
export class ApiController {
  @Get('resource')
  get() { }
  
  @Post('resource')
  post() { }
  
  @Put('resource')
  put() { }
  
  @Delete('resource')
  delete() { }
  
  @Patch('resource')
  patch() { }
  
  @Options('resource')
  options() { }
  
  @Head('resource')
  head() { }
}
```

---

## Path Parameters

### Single Parameter

Extract path parameters using `@Param()`:

```typescript
@Controller('users')
export class UsersController {
  @Get(':id')
  findOne(@Param('id') id: string) {
    return { user: { id } };
  }
}
```

### Multiple Parameters

```typescript
@Controller('posts')
export class PostsController {
  @Get(':userId/posts/:postId')
  getPost(
    @Param('userId') userId: string,
    @Param('postId') postId: string,
  ) {
    return { userId, postId };
  }
}
```

### All Parameters

Get all parameters as an object:

```typescript
@Get(':category/:id')
getItem(@Param() params: any) {
  console.log(params.category, params.id);
  return params;
}
```

### Parameter Validation

Use pipes to validate and transform parameters:

```typescript
import { ParseIntPipe } from '@nestjs/common';

@Get(':id')
findOne(@Param('id', ParseIntPipe) id: number) {
  // id is automatically converted to number
  return { user: { id } };
}
```

---

## Query Parameters

### Single Query Parameter

Extract query parameters using `@Query()`:

```typescript
@Get('search')
search(@Query('q') query: string) {
  return { results: [], query };
}
```

### Multiple Query Parameters

```typescript
@Get('search')
search(
  @Query('q') query: string,
  @Query('page') page: string,
  @Query('limit') limit: string,
) {
  return { query, page, limit };
}
```

### All Query Parameters

Get all query parameters as an object:

```typescript
@Get('search')
search(@Query() query: any) {
  console.log(query); // { q: 'test', page: '1', limit: '10' }
  return { results: [], query };
}
```

### Query Parameter Validation

```typescript
import { ParseIntPipe } from '@nestjs/common';

@Get('users')
findAll(
  @Query('page', ParseIntPipe) page: number,
  @Query('limit', ParseIntPipe) limit: number,
) {
  return { users: [], page, limit };
}
```

---

## Route Middleware

### Guards

Guards determine whether a request should be handled:

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return this.validateRequest(request);
  }
  
  private validateRequest(request: any): boolean {
    // Validate authentication
    return !!request.headers.authorization;
  }
}

// Use guard
@Controller('api')
@UseGuards(AuthGuard)
export class ApiController {
  @Get('protected')
  getProtected() {
    return { data: 'protected' };
  }
}
```

### Pipes

Pipes transform and validate input data:

```typescript
import { PipeTransform, Injectable, BadRequestException, ArgumentMetadata } from '@nestjs/common';

@Injectable()
export class ValidationPipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    // metadata provides information about the argument being processed:
    // - type: 'body' | 'query' | 'param' | 'custom'
    // - metatype: The TypeScript type (e.g., String, Number, CreateUserDto)
    // - data: The parameter name (e.g., 'id', 'email')
    
    if (!value) {
      throw new BadRequestException(`${metadata.data || 'Value'} is required`);
    }
    
    // Example: Use metadata to apply different validation based on type
    if (metadata.type === 'param' && typeof value !== 'string') {
      throw new BadRequestException(`${metadata.data} must be a string`);
    }
    
    return value;
  }
}

// Use pipe
@Post('users')
create(@Body(ValidationPipe) data: any) {
  return { created: true, data };
}
```

### Filters

Filters handle exceptions:

```typescript
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();
    
    response.status(status).json({
      statusCode: status,
      message: exception.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Use filter
@Controller('api')
@UseFilters(HttpExceptionFilter)
export class ApiController {
  @Get('error')
  throwError() {
    throw new HttpException('Something went wrong', 500);
  }
}
```

---

## Execution Order

Middleware executes in this order:

1. **Guards** - Check if request should be processed
2. **Interceptors (before)** - Pre-processing
3. **Pipes** - Transform and validate data
4. **Route Handler** - Execute the controller method
5. **Interceptors (after)** - Post-processing
6. **Filters** - Catch exceptions (if thrown)

```typescript
@UseGuards(AuthGuard)           // 1. Guard
@UseInterceptors(LoggingInterceptor) // 2. Interceptor
@UsePipes(ValidationPipe)       // 3. Pipe
@UseFilters(HttpExceptionFilter) // 6. Filter (if error)
@Get('resource')
getResource() {                 // 4. Handler
  return { data: 'resource' };
}
```

---

## Examples

### RESTful API

```typescript
@Controller('api/posts')
export class PostsController {
  constructor(private postsService: PostsService) {}
  
  @Get()
  async findAll(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.postsService.findAll(page, limit);
  }
  
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.postsService.findOne(id);
  }
  
  @Post()
  @UseGuards(AuthGuard)
  @UsePipes(ValidationPipe)
  async create(@Body() createPostDto: CreatePostDto) {
    return this.postsService.create(createPostDto);
  }
  
  @Put(':id')
  @UseGuards(AuthGuard)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePostDto: UpdatePostDto,
  ) {
    return this.postsService.update(id, updatePostDto);
  }
  
  @Delete(':id')
  @UseGuards(AuthGuard)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.postsService.remove(id);
  }
}
```

### Nested Routes

```typescript
@Controller('users')
export class UsersController {
  @Get(':userId/posts')
  getUserPosts(@Param('userId') userId: string) {
    return { posts: [], userId };
  }
  
  @Get(':userId/posts/:postId')
  getUserPost(
    @Param('userId') userId: string,
    @Param('postId') postId: string,
  ) {
    return { post: {}, userId, postId };
  }
  
  @Get(':userId/posts/:postId/comments')
  getPostComments(
    @Param('userId') userId: string,
    @Param('postId') postId: string,
  ) {
    return { comments: [], userId, postId };
  }
}
```

### Search and Filtering

```typescript
@Controller('api/products')
export class ProductsController {
  @Get('search')
  search(
    @Query('q') query: string,
    @Query('category') category?: string,
    @Query('minPrice') minPrice?: number,
    @Query('maxPrice') maxPrice?: number,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.productsService.search({
      query,
      category,
      minPrice,
      maxPrice,
      page,
      limit,
    });
  }
}
```

### File Upload

```typescript
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('upload')
export class UploadController {
  @Post('file')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return {
      filename: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    };
  }
}
```

### Authentication Routes

```typescript
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}
  
  @Post('login')
  @UsePipes(ValidationPipe)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
  
  @Post('register')
  @UsePipes(ValidationPipe)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }
  
  @Get('profile')
  @UseGuards(AuthGuard)
  async getProfile(@Req() req: any) {
    return req.user;
  }
  
  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(@Req() req: any) {
    return this.authService.logout(req.user);
  }
}
```

### Versioned API

```typescript
@Controller({ path: 'users', version: '1' })
export class UsersV1Controller {
  @Get()
  findAll() {
    return { version: 1, users: [] };
  }
}

@Controller({ path: 'users', version: '2' })
export class UsersV2Controller {
  @Get()
  findAll() {
    return { version: 2, users: [], metadata: {} };
  }
}
```

### Wildcard Routes

```typescript
@Controller('api')
export class ApiController {
  @Get('*')
  catchAll(@Req() req: any) {
    return {
      message: 'Route not found',
      path: req.url,
    };
  }
}
```

### Custom Decorators

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Create custom decorator
export const User = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

// Use custom decorator
@Controller('api')
export class ApiController {
  @Get('me')
  @UseGuards(AuthGuard)
  getMe(@User() user: any) {
    return user;
  }
}
```

### Rate Limiting

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

// IMPORTANT: This uses in-memory storage and only works for single-instance deployments
// For production with multiple server instances, use @nestjs/throttler with Redis
@Injectable()
export class RateLimitGuard implements CanActivate {
  private requests = new Map<string, number[]>();
  private readonly limit = 100;
  private readonly window = 60000; // 1 minute
  
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const ip = request.ip;
    const now = Date.now();
    
    const requests = this.requests.get(ip) || [];
    const recentRequests = requests.filter(time => now - time < this.window);
    
    if (recentRequests.length >= this.limit) {
      return false;
    }
    
    recentRequests.push(now);
    this.requests.set(ip, recentRequests);
    return true;
  }
}

@Controller('api')
@UseGuards(RateLimitGuard)
export class ApiController {
  @Get('resource')
  getResource() {
    return { data: 'resource' };
  }
}

// For distributed rate limiting across multiple server instances:
// npm install @nestjs/throttler @nestjs/throttler-storage-redis
//
// import { ThrottlerModule } from '@nestjs/throttler';
// import { ThrottlerStorageRedisService } from '@nestjs/throttler-storage-redis';
//
// @Module({
//   imports: [
//     ThrottlerModule.forRoot({
//       ttl: 60,
//       limit: 100,
//       storage: new ThrottlerStorageRedisService(redisClient),
//     }),
//   ],
// })
```

---

## See Also

- [Server](./Server.md)
- [Request](./Request.md)
- [Response](./Response.md)
- [Middleware](./Middleware.md)
- [Body Parsing](./Body-Parsing.md)
